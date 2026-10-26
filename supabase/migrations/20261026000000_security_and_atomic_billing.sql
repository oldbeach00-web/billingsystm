-- ════════════════════════════════════════════════════════════════════════════
-- Security lockdown + atomic billing operations
--
-- BEFORE RUNNING:
--   1. Take a backup (Supabase Dashboard → Database → Backups).
--   2. Replace admin@example.com below with the value of SUPABASE_ADMIN_EMAIL.
--      That auth user must already exist (Authentication → Users).
--   3. Run the whole file in the SQL editor. It is wrapped in one transaction.
--
-- AFTER RUNNING:
--   • Authentication → Providers → Email → turn OFF "Allow new users to sign up".
--
-- What this does:
--   • Only users listed in app_admins can read or write any table. The public
--     anon key alone can no longer access data. ALL existing policies on the
--     app tables are dropped and replaced.
--   • create_invoice(): creates the invoice, its items, stock deductions,
--     stock movements and initial payment in ONE transaction, with row locks,
--     a server-side recalculation of every amount, and a sequential
--     invoice number per financial year.
--   • record_payment(): locks the invoice and applies a payment atomically.
--   • adjust_stock(): locks the product and applies a stock change atomically.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── Admin allow-list ──────────────────────────────────────────────────────

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.app_admins (user_id)
select id from auth.users where lower(email) = lower('admin@example.com')
on conflict do nothing;

do $$
begin
  if not exists (select 1 from public.app_admins) then
    raise exception 'No admin user found. Edit the email in this migration to match SUPABASE_ADMIN_EMAIL.';
  end if;
end $$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- ─── Row Level Security on every app table ─────────────────────────────────

do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'app_admins', 'user_profiles', 'categories', 'products', 'customers',
    'invoices', 'invoice_items', 'payments', 'stock_movements',
    'settings', 'notifications'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Table public.% does not exist, skipping', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    execute format('revoke all on public.%I from anon', t);

    if t = 'app_admins' then
      -- Admins may see the list but changes are made from the SQL editor only
      execute format(
        'create policy admin_read on public.%I for select to authenticated using (public.is_app_admin())',
        t
      );
    else
      execute format(
        'create policy admin_all on public.%I for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin())',
        t
      );
    end if;
  end loop;
end $$;

-- ─── Keep invoices.amount_due correct if it is not a generated column ──────

create or replace function public.invoices_set_amount_due()
returns trigger
language plpgsql
as $$
begin
  new.amount_due := greatest(round(coalesce(new.total_amount, 0) - coalesce(new.amount_paid, 0), 2), 0);
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
      and column_name = 'amount_due' and is_generated = 'NEVER'
  ) then
    drop trigger if exists invoices_set_amount_due on public.invoices;
    create trigger invoices_set_amount_due
      before insert or update of total_amount, amount_paid on public.invoices
      for each row execute function public.invoices_set_amount_due();
  end if;
end $$;

-- ─── Sequential invoice numbers ────────────────────────────────────────────

create table if not exists public.invoice_sequences (
  series text primary key,
  last_number integer not null default 0
);

alter table public.invoice_sequences enable row level security;
revoke all on public.invoice_sequences from anon;
drop policy if exists admin_all on public.invoice_sequences;
create policy admin_all on public.invoice_sequences for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

-- Invoice numbers must be unique. This fails (and rolls back everything) if
-- duplicate invoice numbers already exist; find them with:
--   select invoice_number, count(*) from invoices group by 1 having count(*) > 1;
create unique index if not exists invoices_invoice_number_key
  on public.invoices (invoice_number);

-- Returns e.g. INV-2627-00001 (prefix from settings.invoice_prefix, Indian
-- financial year April–March, max 16 characters as required for GST).
create or replace function public.next_invoice_number(p_issue_date date, p_is_draft boolean)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prefix text;
  v_fy_start integer;
  v_series text;
  v_next integer;
  v_number text;
begin
  if p_is_draft then
    v_prefix := 'DRAFT-';
  else
    select coalesce(nullif(regexp_replace(value #>> '{}', '[^A-Za-z0-9/-]', '', 'g'), ''), 'INV-')
      into v_prefix
      from settings where key = 'invoice_prefix';
    v_prefix := coalesce(v_prefix, 'INV-');
  end if;

  v_fy_start := extract(year from p_issue_date)::integer
    - case when extract(month from p_issue_date) < 4 then 1 else 0 end;

  v_series := v_prefix || lpad((v_fy_start % 100)::text, 2, '0')
    || lpad(((v_fy_start + 1) % 100)::text, 2, '0') || '-';

  insert into invoice_sequences (series, last_number)
  values (v_series, 1)
  on conflict (series) do update set last_number = invoice_sequences.last_number + 1
  returning last_number into v_next;

  v_number := v_series || lpad(v_next::text, 5, '0');

  if length(v_number) > 16 then
    raise exception 'Invoice number "%" is longer than 16 characters. Shorten the invoice prefix in Settings.', v_number;
  end if;

  return v_number;
end;
$$;

-- ─── create_invoice ────────────────────────────────────────────────────────
-- Amount math must match src/lib/billing.ts (computeLineAmounts).

create or replace function public.create_invoice(
  p_customer_id uuid,
  p_is_draft boolean,
  p_issue_date date,
  p_due_date date,
  p_overall_discount_pct numeric,
  p_amount_paid numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_qty numeric;
  v_price numeric;
  v_disc_pct numeric;
  v_tax_rate numeric;
  v_gross numeric;
  v_line_disc numeric;
  v_net numeric;
  v_share numeric;
  v_taxable numeric;
  v_tax numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_overall_disc numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric := 0;
  v_paid numeric := round(coalesce(p_amount_paid, 0), 2);
  v_status text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_lines jsonb := '[]'::jsonb;
  v_stock record;
  v_product record;
  v_after numeric;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the bill.';
  end if;

  if p_overall_discount_pct is null or p_overall_discount_pct < 0 or p_overall_discount_pct > 100 then
    raise exception 'Overall discount must be between 0 and 100%%.';
  end if;

  if v_paid < 0 then
    raise exception 'Paid amount cannot be negative.';
  end if;

  if p_is_draft and v_paid > 0 then
    raise exception 'A draft invoice cannot have a payment.';
  end if;

  if not exists (select 1 from customers where id = p_customer_id) then
    raise exception 'Customer not found.';
  end if;

  -- Recalculate every line on the server
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    v_disc_pct := coalesce((v_item->>'discount_percentage')::numeric, 0);
    v_tax_rate := coalesce((v_item->>'tax_rate')::numeric, 0);

    if coalesce(trim(v_item->>'description'), '') = '' then
      raise exception 'Every item needs a description.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity for "%" must be greater than 0.', v_item->>'description';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Price for "%" cannot be negative.', v_item->>'description';
    end if;
    if v_disc_pct < 0 or v_disc_pct > 100 then
      raise exception 'Discount for "%" must be between 0 and 100%%.', v_item->>'description';
    end if;
    if v_tax_rate < 0 or v_tax_rate > 100 then
      raise exception 'GST rate for "%" must be between 0 and 100%%.', v_item->>'description';
    end if;

    v_gross := round(v_qty * v_price, 2);
    v_line_disc := round(v_gross * v_disc_pct / 100, 2);
    v_net := v_gross - v_line_disc;
    v_share := round(v_net * p_overall_discount_pct / 100, 2);
    v_taxable := v_net - v_share;
    v_tax := round(v_taxable * v_tax_rate / 100, 2);
    v_line_total := v_taxable + v_tax;

    v_subtotal := v_subtotal + v_net;
    v_overall_disc := v_overall_disc + v_share;
    v_tax_total := v_tax_total + v_tax;
    v_total := v_total + v_line_total;

    v_lines := v_lines || jsonb_build_object(
      'product_id', nullif(v_item->>'product_id', ''),
      'description', trim(v_item->>'description'),
      'quantity', v_qty,
      'unit_price', v_price,
      'tax_rate', v_tax_rate,
      'tax_amount', v_tax,
      'discount_percentage', v_disc_pct,
      'discount_amount', v_line_disc,
      'total_amount', v_line_total
    );
  end loop;

  if v_paid > v_total then
    raise exception 'Paid amount (%) cannot exceed the invoice total (%).', v_paid, v_total;
  end if;

  if p_is_draft then
    v_status := 'draft';
  elsif v_paid >= v_total then
    v_status := 'paid';
  elsif v_paid > 0 then
    v_status := 'partially_paid';
  else
    v_status := 'due';
  end if;

  v_invoice_number := public.next_invoice_number(p_issue_date, p_is_draft);

  insert into invoices (
    invoice_number, customer_id, status, issue_date, due_date,
    subtotal, tax_amount, discount_amount, total_amount, amount_paid,
    notes, created_by
  ) values (
    v_invoice_number, p_customer_id, v_status::invoice_status, p_issue_date, p_due_date,
    v_subtotal, v_tax_total, v_overall_disc, v_total, v_paid,
    nullif(p_notes, ''), v_user
  )
  returning id into v_invoice_id;

  insert into invoice_items (
    invoice_id, product_id, description, quantity, unit_price,
    tax_rate, tax_amount, discount_percentage, discount_amount, total_amount
  )
  select
    v_invoice_id, (l->>'product_id')::uuid, l->>'description',
    (l->>'quantity')::numeric, (l->>'unit_price')::numeric,
    (l->>'tax_rate')::numeric, (l->>'tax_amount')::numeric,
    (l->>'discount_percentage')::numeric, (l->>'discount_amount')::numeric,
    (l->>'total_amount')::numeric
  from jsonb_array_elements(v_lines) as l;

  -- Deduct stock: one locked, conditional update per product (sorted to
  -- avoid deadlocks between concurrent invoices)
  if not p_is_draft then
    for v_stock in
      select (l->>'product_id')::uuid as product_id, sum((l->>'quantity')::numeric) as qty
      from jsonb_array_elements(v_lines) as l
      where l->>'product_id' is not null
      group by 1
      order by 1
    loop
      select id, name, stock_quantity, is_active into v_product
        from products where id = v_stock.product_id for update;

      if not found then
        raise exception 'A product on this bill no longer exists.';
      end if;
      if not v_product.is_active then
        raise exception 'Product "%" is no longer active.', v_product.name;
      end if;
      if v_product.stock_quantity < v_stock.qty then
        raise exception 'Insufficient stock for "%". Requested: %, Available: %.',
          v_product.name, v_stock.qty, v_product.stock_quantity;
      end if;

      v_after := v_product.stock_quantity - v_stock.qty;

      update products set stock_quantity = v_after where id = v_stock.product_id;

      insert into stock_movements (
        product_id, movement_type, quantity, quantity_before, quantity_after,
        reference_id, reference_type, notes, created_by
      ) values (
        v_stock.product_id, 'sale'::stock_movement_type, -v_stock.qty,
        v_product.stock_quantity, v_after,
        v_invoice_id, 'invoice', 'Sale via Invoice #' || v_invoice_number, v_user
      );
    end loop;
  end if;

  if v_paid > 0 then
    insert into payments (
      invoice_id, payment_date, amount, payment_method, status, notes, created_by
    ) values (
      v_invoice_id, p_issue_date, v_paid,
      coalesce(nullif(p_payment_method, ''), 'cash')::payment_method,
      'completed'::payment_status,
      'Initial payment for Invoice #' || v_invoice_number, v_user
    );
  end if;

  return jsonb_build_object(
    'id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'total_amount', v_total,
    'status', v_status
  );
end;
$$;

-- ─── record_payment ────────────────────────────────────────────────────────

create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_notes text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv record;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_balance numeric;
  v_new_paid numeric;
  v_status text;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;

  select id, invoice_number, status::text as status, total_amount, amount_paid
    into v_inv
    from invoices where id = p_invoice_id for update;

  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status in ('draft', 'cancelled') then
    raise exception 'Payments cannot be recorded against a % invoice.', v_inv.status;
  end if;
  if v_amount <= 0 then
    raise exception 'Payment amount must be greater than 0.';
  end if;

  v_balance := round(v_inv.total_amount - v_inv.amount_paid, 2);

  if v_amount > v_balance then
    raise exception 'Payment (%) exceeds the outstanding balance (%).', v_amount, v_balance;
  end if;

  v_new_paid := v_inv.amount_paid + v_amount;
  v_status := case when v_new_paid >= v_inv.total_amount then 'paid' else 'partially_paid' end;

  insert into payments (
    invoice_id, payment_date, amount, payment_method, status, notes, created_by
  ) values (
    p_invoice_id, coalesce(p_payment_date, current_date), v_amount,
    coalesce(nullif(p_payment_method, ''), 'cash')::payment_method,
    'completed'::payment_status,
    coalesce(nullif(p_notes, ''), 'Payment for Invoice #' || v_inv.invoice_number),
    auth.uid()
  );

  update invoices
     set amount_paid = v_new_paid, status = v_status::invoice_status
   where id = p_invoice_id;

  return jsonb_build_object(
    'amount_paid', v_new_paid,
    'amount_due', v_inv.total_amount - v_new_paid,
    'status', v_status
  );
end;
$$;

-- ─── adjust_stock ──────────────────────────────────────────────────────────

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_change numeric,
  p_movement_type text,
  p_notes text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;
  if p_change is null or p_change = 0 then
    raise exception 'Quantity change must not be zero.';
  end if;

  select stock_quantity into v_before from products where id = p_product_id for update;

  if not found then
    raise exception 'Product not found.';
  end if;

  v_after := v_before + p_change;

  if v_after < 0 then
    raise exception 'Stock cannot go below zero (current stock: %).', v_before;
  end if;

  update products set stock_quantity = v_after where id = p_product_id;

  insert into stock_movements (
    product_id, movement_type, quantity, quantity_before, quantity_after, notes, created_by
  ) values (
    p_product_id, p_movement_type::stock_movement_type, p_change, v_before, v_after,
    nullif(p_notes, ''), auth.uid()
  );

  return jsonb_build_object('quantity_before', v_before, 'quantity_after', v_after);
end;
$$;

-- ─── Function permissions ──────────────────────────────────────────────────

revoke all on function public.next_invoice_number(date, boolean) from public, anon;
revoke all on function public.create_invoice(uuid, boolean, date, date, numeric, numeric, text, text, jsonb) from public, anon;
revoke all on function public.record_payment(uuid, numeric, text, date, text) from public, anon;
revoke all on function public.adjust_stock(uuid, numeric, text, text) from public, anon;

grant execute on function public.next_invoice_number(date, boolean) to authenticated;
grant execute on function public.create_invoice(uuid, boolean, date, date, numeric, numeric, text, text, jsonb) to authenticated;
grant execute on function public.record_payment(uuid, numeric, text, date, text) to authenticated;
grant execute on function public.adjust_stock(uuid, numeric, text, text) to authenticated;

-- The old non-atomic RPC (if it exists) is no longer used by the app
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_invoice_transaction'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

commit;
