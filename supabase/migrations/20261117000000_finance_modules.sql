-- ════════════════════════════════════════════════════════════════════════════
-- Finance modules: Income & Expenses, Profit & Loss, Staff Salaries,
-- Bank & Payment accounts, Supplier ledger & payables
--
-- Run AFTER the 2026-10-26 security migration (it relies on is_app_admin()).
-- Back up first. Wrapped in one transaction; nothing existing is altered.
--
-- Every money movement carries a payment mode ('cash', 'upi' or 'bank') and
-- an account. money_ledger (a view) merges customer payments, other income,
-- expenses, salaries, supplier payments and account transfers into one
-- signed list, so account balances and the Profit & Loss report always agree.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── Bank & payment accounts ───────────────────────────────────────────────

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('cash', 'upi', 'bank')),
  bank_name text,
  account_number text,
  ifsc text,
  upi_id text,
  opening_balance numeric(12,2) not null default 0,
  -- The default account of each kind receives customer payments of that mode
  is_default boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_accounts_one_default_per_kind
  on public.finance_accounts (kind) where is_default;

insert into public.finance_accounts (name, kind, is_default)
select v.name, v.kind, true
from (values ('Cash in Hand', 'cash'), ('UPI', 'upi')) as v(name, kind)
where not exists (select 1 from public.finance_accounts a where a.kind = v.kind and a.is_default);

-- ─── Income & expense entries ──────────────────────────────────────────────

create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('income', 'expense')),
  entry_date date not null default current_date,
  category text not null check (length(trim(category)) > 0),
  description text,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'bank')),
  account_id uuid references public.finance_accounts(id),
  reference text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_entries_date_idx on public.finance_entries (entry_date);

-- ─── Staff & salaries ──────────────────────────────────────────────────────

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text,
  designation text,
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  joining_date date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  -- First day of the month the salary is for
  salary_month date not null check (extract(day from salary_month) = 1),
  payment_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'bank')),
  account_id uuid references public.finance_accounts(id),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists salary_payments_staff_idx on public.salary_payments (staff_id, salary_month);

-- ─── Suppliers, bills (payables) and payments ──────────────────────────────

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text,
  email text,
  gstin text,
  address text,
  -- Amount already owed to the supplier when they were added
  opening_balance numeric(12,2) not null default 0 check (opening_balance >= 0),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  bill_number text,
  bill_date date not null default current_date,
  due_date date,
  amount numeric(12,2) not null check (amount > 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  amount_due numeric(12,2) generated always as (amount - amount_paid) stored,
  status text not null default 'unpaid'
    check (status in ('unpaid', 'partially_paid', 'paid', 'cancelled')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_paid <= amount)
);

create index if not exists supplier_bills_supplier_idx on public.supplier_bills (supplier_id, bill_date);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  -- null = paid "on account" (against the opening balance / overall dues)
  supplier_bill_id uuid references public.supplier_bills(id),
  payment_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'bank')),
  account_id uuid references public.finance_accounts(id),
  reference text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists supplier_payments_supplier_idx on public.supplier_payments (supplier_id, payment_date);

-- ─── Transfers between accounts (e.g. depositing cash in the bank) ─────────

create table if not exists public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_date date not null default current_date,
  from_account_id uuid not null references public.finance_accounts(id),
  to_account_id uuid not null references public.finance_accounts(id),
  amount numeric(12,2) not null check (amount > 0),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);

-- ─── updated_at triggers (set_updated_at already exists) ───────────────────

do $$
declare t text;
begin
  foreach t in array array['finance_accounts', 'finance_entries', 'staff', 'suppliers', 'supplier_bills']
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ─── Row Level Security: admin only, like every other table ────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'finance_accounts', 'finance_entries', 'staff', 'salary_payments',
    'suppliers', 'supplier_bills', 'supplier_payments', 'account_transfers'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format(
      'create policy admin_all on public.%I for all to authenticated
         using (public.is_app_admin()) with check (public.is_app_admin())', t);
  end loop;
end $$;

-- ─── Unified money ledger ──────────────────────────────────────────────────
-- direction: +1 money in, −1 money out. Customer payments without an account
-- go to the default account of their mode; cash/upi map directly, every other
-- method (bank transfer, card, cheque…) counts as 'bank'.

create or replace function public.default_account_for(p_mode text)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select id from finance_accounts
  where kind = p_mode and is_default and is_active
  limit 1;
$$;

create or replace view public.money_ledger
with (security_invoker = true) as
  select
    (p.payment_date at time zone 'Asia/Kolkata')::date as entry_date,
    'customer_payment'::text as source,
    1 as direction,
    p.amount,
    m.mode,
    public.default_account_for(m.mode) as account_id,
    'Payment for invoice ' || coalesce(i.invoice_number, '') as description,
    coalesce(c.name, '') as party,
    p.id as source_id
  from payments p
  cross join lateral (
    select case p.payment_method::text when 'cash' then 'cash' when 'upi' then 'upi' else 'bank' end as mode
  ) m
  left join invoices i on i.id = p.invoice_id
  left join customers c on c.id = i.customer_id
  where p.status::text = 'completed'

  union all
  select e.entry_date, e.entry_type,
         case e.entry_type when 'income' then 1 else -1 end,
         e.amount, e.payment_mode,
         coalesce(e.account_id, public.default_account_for(e.payment_mode)),
         e.category || coalesce(' – ' || nullif(e.description, ''), ''),
         '', e.id
  from finance_entries e

  union all
  select s.payment_date, 'salary', -1, s.amount, s.payment_mode,
         coalesce(s.account_id, public.default_account_for(s.payment_mode)),
         'Salary for ' || to_char(s.salary_month, 'Mon YYYY'),
         st.name, s.id
  from salary_payments s
  join staff st on st.id = s.staff_id

  union all
  select sp.payment_date, 'supplier_payment', -1, sp.amount, sp.payment_mode,
         coalesce(sp.account_id, public.default_account_for(sp.payment_mode)),
         'Supplier payment' || coalesce(' – bill ' || nullif(b.bill_number, ''), ''),
         su.name, sp.id
  from supplier_payments sp
  join suppliers su on su.id = sp.supplier_id
  left join supplier_bills b on b.id = sp.supplier_bill_id

  union all
  select t.transfer_date, 'transfer_out', -1, t.amount, fa.kind, t.from_account_id,
         'Transfer to ' || ta.name || coalesce(' – ' || nullif(t.notes, ''), ''), '', t.id
  from account_transfers t
  join finance_accounts fa on fa.id = t.from_account_id
  join finance_accounts ta on ta.id = t.to_account_id

  union all
  select t.transfer_date, 'transfer_in', 1, t.amount, ta.kind, t.to_account_id,
         'Transfer from ' || fa.name || coalesce(' – ' || nullif(t.notes, ''), ''), '', t.id
  from account_transfers t
  join finance_accounts fa on fa.id = t.from_account_id
  join finance_accounts ta on ta.id = t.to_account_id;

create or replace view public.account_balances
with (security_invoker = true) as
  select a.id, a.name, a.kind, a.opening_balance, a.is_default, a.is_active,
         coalesce(sum(l.direction * l.amount) filter (where l.direction > 0), 0) as total_in,
         coalesce(-sum(l.direction * l.amount) filter (where l.direction < 0), 0) as total_out,
         a.opening_balance + coalesce(sum(l.direction * l.amount), 0) as balance
  from finance_accounts a
  left join money_ledger l on l.account_id = a.id
  group by a.id;

create or replace view public.supplier_balances
with (security_invoker = true) as
  select s.id, s.name, s.opening_balance,
         coalesce(b.billed, 0) as total_billed,
         coalesce(p.paid, 0) as total_paid,
         s.opening_balance + coalesce(b.billed, 0) - coalesce(p.paid, 0) as outstanding
  from suppliers s
  left join (
    select supplier_id, sum(amount) as billed
    from supplier_bills where status <> 'cancelled' group by supplier_id
  ) b on b.supplier_id = s.id
  left join (
    select supplier_id, sum(amount) as paid
    from supplier_payments group by supplier_id
  ) p on p.supplier_id = s.id;

revoke all on public.money_ledger, public.account_balances, public.supplier_balances from anon;
grant select on public.money_ledger, public.account_balances, public.supplier_balances to authenticated;

-- ─── pay_supplier: one locked transaction per payment ──────────────────────

create or replace function public.pay_supplier(
  p_supplier_id uuid,
  p_bill_id uuid,
  p_amount numeric,
  p_payment_mode text,
  p_account_id uuid,
  p_payment_date date,
  p_reference text,
  p_notes text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_bill record;
  v_new_paid numeric;
  v_status text;
  v_payment_id uuid;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;
  if v_amount <= 0 then
    raise exception 'Payment amount must be greater than 0.';
  end if;
  if p_payment_mode not in ('cash', 'upi', 'bank') then
    raise exception 'Choose Cash, UPI or Bank as the payment mode.';
  end if;
  if not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Supplier not found.';
  end if;
  if p_account_id is not null and not exists (
    select 1 from finance_accounts where id = p_account_id and is_active
  ) then
    raise exception 'The selected account is not active.';
  end if;

  if p_bill_id is not null then
    select id, supplier_id, bill_number, amount, amount_paid, status
      into v_bill
      from supplier_bills where id = p_bill_id for update;

    if not found or v_bill.supplier_id <> p_supplier_id then
      raise exception 'Bill not found for this supplier.';
    end if;
    if v_bill.status = 'cancelled' then
      raise exception 'Bill % is cancelled.', coalesce(v_bill.bill_number, '');
    end if;
    if v_amount > v_bill.amount - v_bill.amount_paid then
      raise exception 'Payment (%) exceeds the bill balance (%).',
        v_amount, v_bill.amount - v_bill.amount_paid;
    end if;

    v_new_paid := v_bill.amount_paid + v_amount;
    v_status := case when v_new_paid >= v_bill.amount then 'paid' else 'partially_paid' end;

    update supplier_bills set amount_paid = v_new_paid, status = v_status where id = p_bill_id;
  end if;

  insert into supplier_payments (
    supplier_id, supplier_bill_id, payment_date, amount, payment_mode,
    account_id, reference, notes
  ) values (
    p_supplier_id, p_bill_id, coalesce(p_payment_date, current_date), v_amount,
    p_payment_mode, p_account_id, nullif(trim(p_reference), ''), nullif(trim(p_notes), '')
  )
  returning id into v_payment_id;

  return jsonb_build_object('id', v_payment_id, 'bill_status', v_status);
end;
$$;

-- ─── cancel_supplier_bill: only while nothing has been paid against it ─────

create or replace function public.cancel_supplier_bill(p_bill_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare v_bill record;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;

  select id, amount_paid, status into v_bill from supplier_bills where id = p_bill_id for update;

  if not found then
    raise exception 'Bill not found.';
  end if;
  if v_bill.status = 'cancelled' then
    raise exception 'This bill is already cancelled.';
  end if;
  if v_bill.amount_paid > 0 then
    raise exception 'This bill has payments against it and cannot be cancelled.';
  end if;

  update supplier_bills set status = 'cancelled' where id = p_bill_id;
end;
$$;

revoke all on function public.default_account_for(text) from public, anon;
revoke all on function public.pay_supplier(uuid, uuid, numeric, text, uuid, date, text, text) from public, anon;
revoke all on function public.cancel_supplier_bill(uuid) from public, anon;
grant execute on function public.default_account_for(text) to authenticated;
grant execute on function public.pay_supplier(uuid, uuid, numeric, text, uuid, date, text, text) to authenticated;
grant execute on function public.cancel_supplier_bill(uuid) to authenticated;

commit;
