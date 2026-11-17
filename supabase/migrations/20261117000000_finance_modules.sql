-- ════════════════════════════════════════════════════════════════════════════
-- Finance modules: Income & Expenses, Profit & Loss, Staff Salaries,
-- Bank & Payment accounts, Supplier ledger & payables
--
-- Run AFTER the 2026-10-26 security migration (it relies on is_app_admin()
-- and set_updated_at()). Back up first. Wrapped in one transaction and safe
-- to run again. Undo with supabase/rollback/20261117_drop_finance_modules.sql.
--
-- Existing tables and rows are not altered: this only creates new tables,
-- views, functions and triggers on the new tables. The views READ payments,
-- invoices and customers.
--
-- Accounting rules enforced here:
--   • Every new money movement stores its account permanently (account_id is
--     required) and the account must be active and match the payment mode
--     (cash / upi / bank). Bank-mode entries therefore need a bank account,
--     which the accountant adds manually; none is created automatically.
--   • Customer payments (existing payments table) go to the default account
--     of their mode that was in effect WHEN THE PAYMENT WAS RECORDED. Every
--     default change is logged with a start time, so changing the default
--     never moves past transactions between accounts.
--   • A refunded customer payment stays as money in on its payment date and
--     adds money out on the refund date, so past periods don't change.
--   • Supplier bills and payments change only through pay_supplier,
--     cancel_supplier_bill and delete_supplier_payment, which lock the bill.
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
  -- Current default of its kind (customer payments of that mode go here).
  -- Changed only through set_default_account(), which logs the change.
  is_default boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_accounts_one_default_per_kind
  on public.finance_accounts (kind) where is_default;

-- History of default accounts. The row in effect at a payment's recording
-- time decides which account that customer payment belongs to.
create table if not exists public.finance_default_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cash', 'upi', 'bank')),
  account_id uuid not null references public.finance_accounts(id),
  -- '-infinity' for the first default of a kind: it covers everything before
  effective_from timestamptz not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (kind, effective_from)
);

-- Default Cash and UPI accounts (no bank account: the accountant adds those)
do $$
declare v record; v_id uuid;
begin
  -- Pass the integrity guards (they exist when this migration is re-run)
  perform set_config('app.finance_rpc', 'on', true);
  for v in select * from (values ('Cash in Hand', 'cash'), ('UPI', 'upi')) as x(name, kind)
  loop
    if not exists (select 1 from public.finance_default_accounts where kind = v.kind) then
      select id into v_id from public.finance_accounts where kind = v.kind and is_default;
      if v_id is null then
        insert into public.finance_accounts (name, kind, is_default)
        values (v.name, v.kind, true) returning id into v_id;
      end if;
      insert into public.finance_default_accounts (kind, account_id, effective_from)
      values (v.kind, v_id, '-infinity');
    end if;
  end loop;
  perform set_config('app.finance_rpc', 'off', true);
end $$;

-- ─── Income & expense entries ──────────────────────────────────────────────

create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('income', 'expense')),
  entry_date date not null default current_date,
  category text not null check (length(trim(category)) > 0),
  description text,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'bank')),
  account_id uuid not null references public.finance_accounts(id),
  reference text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_entries_date_idx on public.finance_entries (entry_date);
create index if not exists finance_entries_account_idx on public.finance_entries (account_id);

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
  account_id uuid not null references public.finance_accounts(id),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists salary_payments_staff_idx on public.salary_payments (staff_id, salary_month);
create index if not exists salary_payments_account_idx on public.salary_payments (account_id);

-- ─── Suppliers, bills (payables) and payments ──────────────────────────────

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text,
  email text,
  gstin text,
  address text,
  -- Owed to the supplier when they were added (negative = advance paid)
  opening_balance numeric(12,2) not null default 0,
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
  check (amount_paid <= amount),
  check (due_date is null or due_date >= bill_date)
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
  account_id uuid not null references public.finance_accounts(id),
  reference text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists supplier_payments_supplier_idx on public.supplier_payments (supplier_id, payment_date);
create index if not exists supplier_payments_bill_idx on public.supplier_payments (supplier_bill_id);
create index if not exists supplier_payments_account_idx on public.supplier_payments (account_id);

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

create index if not exists account_transfers_from_idx on public.account_transfers (from_account_id);
create index if not exists account_transfers_to_idx on public.account_transfers (to_account_id);

-- ─── Integrity triggers ────────────────────────────────────────────────────

-- created_by is always the signed-in user, never a value sent by the client
create or replace function public.finance_set_created_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

-- The account must exist, be active, and be of the same kind as the mode
create or replace function public.finance_check_account()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_kind text; v_active boolean; v_name text;
begin
  if tg_op = 'UPDATE'
     and new.account_id is not distinct from old.account_id
     and new.payment_mode is not distinct from old.payment_mode then
    return new;
  end if;

  select kind, is_active, name into v_kind, v_active, v_name
    from finance_accounts where id = new.account_id;

  if not found then
    raise exception 'Choose the % account this money moved through.',
      case new.payment_mode when 'bank' then 'bank' when 'upi' then 'UPI' else 'cash' end;
  end if;
  if not v_active then
    raise exception 'Account "%" is closed. Choose an active account.', v_name;
  end if;
  if v_kind <> new.payment_mode then
    raise exception 'Account "%" is a % account but the payment mode is %.',
      v_name, upper(v_kind), upper(new.payment_mode);
  end if;
  return new;
end;
$$;

create or replace function public.finance_check_transfer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from finance_accounts
    where id in (new.from_account_id, new.to_account_id) and not is_active
  ) then
    raise exception 'Transfers can only use active accounts.';
  end if;
  return new;
end;
$$;

-- Accounts: type is fixed once created; default only via set_default_account;
-- the current default cannot be closed.
create or replace function public.finance_guard_account()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_default and coalesce(current_setting('app.finance_rpc', true), '') <> 'on' then
      raise exception 'Use "Make default" to choose a default account.';
    end if;
    return new;
  end if;

  if new.kind <> old.kind then
    raise exception 'An account''s type (Cash / UPI / Bank) cannot be changed. Add a new account instead.';
  end if;
  if new.is_default <> old.is_default
     and coalesce(current_setting('app.finance_rpc', true), '') <> 'on' then
    raise exception 'Use "Make default" to change the default account.';
  end if;
  if old.is_default and not new.is_active then
    raise exception 'This is the default % account. Make another account the default before closing it.', upper(old.kind);
  end if;
  return new;
end;
$$;

-- Supplier bills: amount_paid and status change only through the payable
-- functions; bills are cancelled, never deleted; a bill's supplier is fixed.
create or replace function public.finance_guard_bill()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_rpc boolean := coalesce(current_setting('app.finance_rpc', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.amount_paid <> 0 or new.status <> 'unpaid' then
      raise exception 'A new bill starts unpaid. Record payments with Pay Supplier.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Bills cannot be deleted. Cancel the bill instead.';
  end if;
  if not v_rpc and (new.amount_paid <> old.amount_paid or new.status <> old.status) then
    raise exception 'Bill payments and status change only through Pay Supplier or Cancel.';
  end if;
  if new.supplier_id <> old.supplier_id then
    raise exception 'A bill cannot be moved to another supplier.';
  end if;
  if old.status = 'cancelled' and not v_rpc then
    raise exception 'This bill is cancelled and cannot be edited.';
  end if;
  -- Keep status consistent with the amounts (e.g. after the amount is edited)
  if new.status <> 'cancelled' then
    new.status := case when new.amount_paid = 0 then 'unpaid'
                       when new.amount_paid >= new.amount then 'paid'
                       else 'partially_paid' end;
  end if;
  return new;
end;
$$;

-- Supplier payments are corrected only through delete_supplier_payment()
create or replace function public.finance_guard_supplier_payment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.finance_rpc', true), '') <> 'on' then
    raise exception 'Supplier payments are recorded with Pay Supplier and removed with Delete payment.';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  -- updated_at
  foreach t in array array['finance_accounts', 'finance_entries', 'staff', 'suppliers', 'supplier_bills']
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I
                      for each row execute function public.set_updated_at()', t);
  end loop;

  -- created_by
  foreach t in array array['finance_default_accounts', 'finance_entries', 'salary_payments',
                           'supplier_bills', 'supplier_payments', 'account_transfers']
  loop
    execute format('drop trigger if exists trg_%1$s_created_by on public.%1$I', t);
    execute format('create trigger trg_%1$s_created_by before insert on public.%1$I
                      for each row execute function public.finance_set_created_by()', t);
  end loop;

  -- account matches payment mode
  foreach t in array array['finance_entries', 'salary_payments', 'supplier_payments']
  loop
    execute format('drop trigger if exists trg_%1$s_account on public.%1$I', t);
    execute format('create trigger trg_%1$s_account before insert or update on public.%1$I
                      for each row execute function public.finance_check_account()', t);
  end loop;
end $$;

drop trigger if exists trg_account_transfers_accounts on public.account_transfers;
create trigger trg_account_transfers_accounts before insert or update on public.account_transfers
  for each row execute function public.finance_check_transfer();

drop trigger if exists trg_finance_accounts_guard on public.finance_accounts;
create trigger trg_finance_accounts_guard before insert or update on public.finance_accounts
  for each row execute function public.finance_guard_account();

drop trigger if exists trg_supplier_bills_guard on public.supplier_bills;
create trigger trg_supplier_bills_guard before insert or update or delete on public.supplier_bills
  for each row execute function public.finance_guard_bill();

drop trigger if exists trg_supplier_payments_guard on public.supplier_payments;
create trigger trg_supplier_payments_guard before update or delete on public.supplier_payments
  for each row execute function public.finance_guard_supplier_payment();

-- Default-account history is append-only (written by set_default_account)
create or replace function public.finance_guard_default_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' or coalesce(current_setting('app.finance_rpc', true), '') <> 'on' then
    raise exception 'Default-account history is changed only by "Make default".';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_default_accounts_guard on public.finance_default_accounts;
create trigger trg_finance_default_accounts_guard before insert or update or delete on public.finance_default_accounts
  for each row execute function public.finance_guard_default_history();

-- ─── Row Level Security: admin only, like every other table ────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'finance_accounts', 'finance_default_accounts', 'finance_entries', 'staff',
    'salary_payments', 'suppliers', 'supplier_bills', 'supplier_payments', 'account_transfers'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format(
      'create policy admin_all on public.%I for all to authenticated
         using (public.is_app_admin()) with check (public.is_app_admin())', t);
  end loop;
end $$;

-- ─── Unified money ledger ──────────────────────────────────────────────────
-- direction: +1 money in, −1 money out. Every row carries the account it
-- was recorded against; nothing here depends on the CURRENT default.

create or replace view public.money_ledger
with (security_invoker = true) as
  with customer_payments as (
    select p.*,
           case p.payment_method::text when 'cash' then 'cash' when 'upi' then 'upi' else 'bank' end as mode,
           (
             select d.account_id from finance_default_accounts d
             where d.kind = case p.payment_method::text when 'cash' then 'cash' when 'upi' then 'upi' else 'bank' end
               and d.effective_from <= p.created_at
             order by d.effective_from desc
             limit 1
           ) as account_id
    from payments p
    where p.status::text in ('completed', 'refunded')
  )
  select
    (cp.payment_date at time zone 'Asia/Kolkata')::date as entry_date,
    'customer_payment'::text as source,
    1 as direction,
    cp.amount,
    cp.mode,
    cp.account_id,
    'Payment for invoice ' || coalesce(i.invoice_number, '') as description,
    coalesce(c.name, '') as party,
    cp.id as source_id
  from customer_payments cp
  left join invoices i on i.id = cp.invoice_id
  left join customers c on c.id = i.customer_id

  union all
  -- A refund is money out on the day the invoice was cancelled (when the
  -- payment row was marked refunded), from the same account it came into.
  select (cp.updated_at at time zone 'Asia/Kolkata')::date, 'customer_refund', -1,
         cp.amount, cp.mode, cp.account_id,
         'Refund for cancelled invoice ' || coalesce(i.invoice_number, ''),
         coalesce(c.name, ''), cp.id
  from customer_payments cp
  left join invoices i on i.id = cp.invoice_id
  left join customers c on c.id = i.customer_id
  where cp.status::text = 'refunded'

  union all
  select e.entry_date, e.entry_type,
         case e.entry_type when 'income' then 1 else -1 end,
         e.amount, e.payment_mode, e.account_id,
         e.category || coalesce(' – ' || nullif(e.description, ''), ''),
         '', e.id
  from finance_entries e

  union all
  select s.payment_date, 'salary', -1, s.amount, s.payment_mode, s.account_id,
         'Salary for ' || to_char(s.salary_month, 'Mon YYYY'),
         st.name, s.id
  from salary_payments s
  join staff st on st.id = s.staff_id

  union all
  select sp.payment_date, 'supplier_payment', -1, sp.amount, sp.payment_mode, sp.account_id,
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
         coalesce(sum(l.amount) filter (where l.direction > 0), 0) as total_in,
         coalesce(sum(l.amount) filter (where l.direction < 0), 0) as total_out,
         a.opening_balance + coalesce(sum(l.direction * l.amount), 0) as balance
  from finance_accounts a
  left join money_ledger l on l.account_id = a.id
  group by a.id;

-- Customer payments with no account to go to (a bank/card/cheque payment
-- recorded before any bank account was made default). Shown as a warning.
create or replace view public.unassigned_customer_payments
with (security_invoker = true) as
  select source_id as payment_id, entry_date, amount, mode, description, party
  from money_ledger
  where source = 'customer_payment' and account_id is null;

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

revoke all on public.money_ledger, public.account_balances,
  public.unassigned_customer_payments, public.supplier_balances from anon;
grant select on public.money_ledger, public.account_balances,
  public.unassigned_customer_payments, public.supplier_balances to authenticated;

-- ─── set_default_account: change the default without rewriting history ────

create or replace function public.set_default_account(p_account_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare v_acc record;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;

  select id, kind, is_active, is_default into v_acc
    from finance_accounts where id = p_account_id for update;
  if not found then
    raise exception 'Account not found.';
  end if;
  if not v_acc.is_active then
    raise exception 'A closed account cannot be the default.';
  end if;
  if v_acc.is_default then
    return;
  end if;

  -- Serialise default changes for this kind
  perform 1 from finance_accounts where kind = v_acc.kind for update;
  perform set_config('app.finance_rpc', 'on', true);

  update finance_accounts set is_default = false where kind = v_acc.kind and is_default;
  update finance_accounts set is_default = true where id = p_account_id;

  -- The first default of a kind covers earlier payments; later changes
  -- apply only from now on.
  insert into finance_default_accounts (kind, account_id, effective_from)
  values (
    v_acc.kind, p_account_id,
    case when exists (select 1 from finance_default_accounts where kind = v_acc.kind)
         then clock_timestamp() else '-infinity'::timestamptz end
  );

  perform set_config('app.finance_rpc', 'off', true);
end;
$$;

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
  if p_payment_mode is null or p_payment_mode not in ('cash', 'upi', 'bank') then
    raise exception 'Choose Cash, UPI or Bank as the payment mode.';
  end if;
  if not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Supplier not found.';
  end if;

  perform set_config('app.finance_rpc', 'on', true);

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

  -- finance_check_account validates the account against the mode
  insert into supplier_payments (
    supplier_id, supplier_bill_id, payment_date, amount, payment_mode,
    account_id, reference, notes
  ) values (
    p_supplier_id, p_bill_id, coalesce(p_payment_date, current_date), v_amount,
    p_payment_mode, p_account_id, nullif(trim(p_reference), ''), nullif(trim(p_notes), '')
  )
  returning id into v_payment_id;

  perform set_config('app.finance_rpc', 'off', true);

  return jsonb_build_object('id', v_payment_id, 'bill_status', v_status);
end;
$$;

-- ─── delete_supplier_payment: correct a mistaken payment ───────────────────

create or replace function public.delete_supplier_payment(p_payment_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare v_pay record; v_bill record; v_new_paid numeric;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;

  select id, supplier_bill_id, amount into v_pay
    from supplier_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found.';
  end if;

  perform set_config('app.finance_rpc', 'on', true);

  if v_pay.supplier_bill_id is not null then
    select id, amount, amount_paid into v_bill
      from supplier_bills where id = v_pay.supplier_bill_id for update;
    v_new_paid := greatest(v_bill.amount_paid - v_pay.amount, 0);
    update supplier_bills
       set amount_paid = v_new_paid,
           status = case when v_new_paid = 0 then 'unpaid'
                         when v_new_paid >= v_bill.amount then 'paid'
                         else 'partially_paid' end
     where id = v_bill.id;
  end if;

  delete from supplier_payments where id = p_payment_id;

  perform set_config('app.finance_rpc', 'off', true);
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
    raise exception 'This bill has payments against it and cannot be cancelled. Delete those payments first.';
  end if;

  perform set_config('app.finance_rpc', 'on', true);
  update supplier_bills set status = 'cancelled' where id = p_bill_id;
  perform set_config('app.finance_rpc', 'off', true);
end;
$$;

-- ─── Function permissions ──────────────────────────────────────────────────

do $$
declare f text;
begin
  foreach f in array array[
    'public.finance_set_created_by()', 'public.finance_check_account()',
    'public.finance_check_transfer()', 'public.finance_guard_account()',
    'public.finance_guard_bill()', 'public.finance_guard_supplier_payment()',
    'public.finance_guard_default_history()'
  ]
  loop
    -- Trigger functions: nobody calls these directly
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'public.set_default_account(uuid)',
    'public.pay_supplier(uuid, uuid, numeric, text, uuid, date, text, text)',
    'public.delete_supplier_payment(uuid)',
    'public.cancel_supplier_bill(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
