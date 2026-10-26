-- ════════════════════════════════════════════════════════════════════════════
-- READ-ONLY database health check for the billing system
--
-- Safe on production: it is a single SELECT in a READ ONLY transaction, so
-- nothing can be changed. Paste the whole file into Supabase → SQL editor and
-- run it. It returns one checklist; look at every row whose status is not OK.
-- Works both before and after the 2026-10-26 migrations.
-- ════════════════════════════════════════════════════════════════════════════

begin transaction read only;

with
app_tables(name) as (
  values ('user_profiles'),('categories'),('products'),('customers'),('invoices'),
         ('invoice_items'),('payments'),('stock_movements'),('settings'),('notifications')
),
paid_vs_payments as (
  select i.invoice_number, i.amount_paid,
         coalesce(sum(p.amount) filter (where p.status::text = 'completed'), 0) as payments_total
  from public.invoices i left join public.payments p on p.invoice_id = i.id
  where i.status::text <> 'cancelled'
  group by i.id, i.invoice_number, i.amount_paid
  having round(i.amount_paid, 2)
         <> round(coalesce(sum(p.amount) filter (where p.status::text = 'completed'), 0), 2)
),
total_vs_items as (
  select i.invoice_number, i.total_amount, round(sum(it.total_amount), 2) as items_total
  from public.invoices i join public.invoice_items it on it.invoice_id = i.id
  group by i.id, i.invoice_number, i.total_amount
  having abs(i.total_amount - sum(it.total_amount)) >= 0.01
),
stock_vs_log as (
  select p.sku, p.name, p.stock_quantity, m.quantity_after as last_logged
  from public.products p
  join lateral (
    select quantity_after from public.stock_movements sm
    where sm.product_id = p.id order by sm.created_at desc limit 1
  ) m on true
  where m.quantity_after <> p.stock_quantity
),
checks(section, item, status, detail) as (

  -- ── Security ──────────────────────────────────────────────────────────────
  select 'Security', 'RLS enabled on ' || t.name,
         case when c.relrowsecurity then 'OK' else 'PROBLEM' end,
         case when c.oid is null then 'table not found'
              when c.relrowsecurity then '' else 'Row Level Security is OFF' end
  from app_tables t
  left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace

  union all
  select 'Security', 'Policy ' || tablename || '.' || policyname,
         case when roles && array['anon','public']::name[] then 'PROBLEM'
              when coalesce(qual, '') in ('true', '(true)') then 'PROBLEM'
              else 'OK' end,
         'roles=' || roles::text || ' cmd=' || cmd || ' using=' || coalesce(qual, '-')
  from pg_policies where schemaname = 'public'

  union all
  select 'Security', 'anon grants on ' || table_name, 'PROBLEM',
         string_agg(privilege_type, ', ') || ' — anon key can use these if RLS allows'
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
  group by table_name

  union all
  select 'Security', 'Auth users', 'REVIEW',
         count(*) || ' user(s): ' || string_agg(email || ' (created ' || created_at::date || ')', ', ' order by created_at)
         || ' — every one of these can sign in with the public key'
  from auth.users

  union all
  select 'Security', 'Admin allow-list (app_admins)',
         case when to_regclass('public.app_admins') is null then 'MISSING' else 'REVIEW' end,
         case when to_regclass('public.app_admins') is null
              then 'migration 20261026000000 not applied'
              -- query_to_xml runs the count only when the table exists
              else substring(query_to_xml(
                     'select count(*) as n from public.app_admins', false, false, '')::text
                     from '<n>([0-9]+)</n>')
                   || ' admin(s) — must be only your SUPABASE_ADMIN_EMAIL user' end

  -- ── Migration status ──────────────────────────────────────────────────────
  union all
  select 'Migrations', 'function ' || f.name,
         case when p.oid is null then 'MISSING' else 'OK' end,
         case when p.oid is null then 'apply the migrations in supabase/migrations' else '' end
  from (values ('is_app_admin'),('next_invoice_number'),('create_invoice'),
               ('record_payment'),('adjust_stock'),('cancel_invoice')) f(name)
  left join pg_proc p on p.proname = f.name and p.pronamespace = 'public'::regnamespace

  union all
  select 'Migrations', 'column ' || x.tbl || '.' || x.col,
         case when c.column_name is null then 'MISSING' else 'OK' end,
         coalesce(c.data_type || case when c.is_generated = 'ALWAYS' then ' (generated)' else '' end, 'not found')
  from (values ('invoices','amount_due'),('invoices','place_of_supply'),('invoices','supply_type'),
               ('invoice_items','hsn_sac'),('products','hsn_sac')) x(tbl, col)
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = x.tbl and c.column_name = x.col

  union all
  select 'Migrations', 'enum ' || t.typname, 'OK',
         string_agg(e.enumlabel, ', ' order by e.enumsortorder)
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typname in ('invoice_status','payment_method','payment_status','stock_movement_type')
  group by t.typname

  union all
  select 'Migrations', 'invoice_status has partially_paid and due',
         case when count(*) = 2 then 'OK' else 'PROBLEM' end,
         'found: ' || coalesce(string_agg(e.enumlabel, ', '), 'none')
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typname = 'invoice_status' and e.enumlabel in ('partially_paid', 'due')

  -- ── Data integrity ────────────────────────────────────────────────────────
  union all
  select 'Data', 'Duplicate invoice numbers',
         case when count(*) = 0 then 'OK' else 'PROBLEM' end,
         coalesce(string_agg(invoice_number || ' ×' || n, ', '), '')
         || case when count(*) > 0 then ' — blocks the migration''s unique index' else '' end
  from (select invoice_number, count(*) n from public.invoices group by 1 having count(*) > 1) d

  union all
  select 'Data', 'Negative stock',
         case when count(*) = 0 then 'OK' else 'PROBLEM' end,
         coalesce(string_agg(name || ' = ' || stock_quantity, ', '), '')
  from public.products where stock_quantity < 0

  union all
  select 'Data', 'Stock differs from last stock-movement entry',
         case when count(*) = 0 then 'OK' else 'PROBLEM' end,
         count(*) || ' product(s). ' || coalesce(string_agg(name || ': stock ' || stock_quantity
           || ' vs log ' || last_logged, '; '), '')
  from (select * from stock_vs_log limit 20) s

  union all
  select 'Data', 'amount_paid differs from completed payments',
         case when count(*) = 0 then 'OK' else 'PROBLEM' end,
         count(*) || ' invoice(s). ' || coalesce(string_agg(invoice_number || ': paid ' || amount_paid
           || ' vs payments ' || payments_total, '; '), '')
  from (select * from paid_vs_payments limit 20) s

  union all
  select 'Data', 'Status contradicts amounts',
         case when count(*) = 0 then 'OK' else 'PROBLEM' end,
         count(*) || ' invoice(s). ' || coalesce(string_agg(invoice_number || ' ' || status
           || ' total ' || total_amount || ' paid ' || amount_paid, '; '), '')
  from (
    select * from public.invoices
    where status::text not in ('draft', 'cancelled')
      and ((round(amount_paid, 2) >= round(total_amount, 2) and status::text <> 'paid')
        or (round(amount_paid, 2) < round(total_amount, 2) and status::text = 'paid')
        or amount_paid > total_amount or amount_paid < 0)
    limit 20
  ) s

  union all
  select 'Data', 'Bills stuck with a balance under ₹1 (old rounding bug)',
         case when count(*) = 0 then 'OK' else 'REVIEW' end,
         count(*) || ' invoice(s). ' || coalesce(string_agg(invoice_number || ' due ' || amount_due, '; '), '')
  from (
    select invoice_number, amount_due from public.invoices
    where status::text not in ('draft', 'cancelled', 'paid')
      and amount_due > 0 and amount_due < 1
    limit 20
  ) s

  union all
  select 'Data', 'amount_due ≠ total − paid',
         case when count(*) = 0 then 'OK' else 'PROBLEM' end,
         count(*) || ' invoice(s). ' || coalesce(string_agg(invoice_number, ', '), '')
  from (
    select invoice_number from public.invoices
    where status::text <> 'cancelled'
      and round(amount_due, 2) <> round(greatest(total_amount - amount_paid, 0), 2)
    limit 20
  ) s

  union all
  select 'Data', 'Invoice total ≠ sum of line totals',
         case when count(*) = 0 then 'OK' else 'REVIEW' end,
         count(*) || ' invoice(s) (expected for old invoices with an overall discount). '
         || coalesce(string_agg(invoice_number || ': ' || total_amount || ' vs ' || items_total, '; '), '')
  from (select * from total_vs_items limit 20) s

  union all
  select 'Data', 'Old invoices with overall discount (GST charged before discount)',
         case when count(*) = 0 then 'OK' else 'REVIEW' end,
         count(*) || ' invoice(s) created by the old app may have overcharged GST. '
         || coalesce(string_agg(invoice_number, ', '), '')
  from (
    -- New invoices are numbered PREFIX-YYYY-NNNNN and computed correctly
    select invoice_number from public.invoices
    where discount_amount > 0 and status::text <> 'cancelled'
      and invoice_number !~ '-[0-9]{4}-[0-9]{5}$'
    limit 50
  ) s

  union all
  select 'Data', 'Amounts with more than 2 decimals',
         case when count(*) = 0 then 'OK' else 'PROBLEM' end,
         count(*) || ' invoice(s). ' || coalesce(string_agg(invoice_number, ', '), '')
  from (
    select invoice_number from public.invoices
    where total_amount <> round(total_amount, 2) or tax_amount <> round(tax_amount, 2)
       or amount_paid <> round(amount_paid, 2)
    limit 20
  ) s

  union all
  select 'Data', 'Payments on draft/cancelled invoices',
         case when count(*) = 0 then 'OK' else 'PROBLEM' end,
         count(*) || ' payment(s). ' || coalesce(string_agg(invoice_number || ' (' || status || ') ' || amount, '; '), '')
  from (
    select i.invoice_number, i.status::text as status, p.amount
    from public.payments p join public.invoices i on i.id = p.invoice_id
    where i.status::text in ('draft', 'cancelled') and p.status::text = 'completed'
    limit 20
  ) s

  union all
  select 'Data', 'Odd dates (future issue date, or due before issue)',
         case when count(*) = 0 then 'OK' else 'REVIEW' end,
         count(*) || ' invoice(s). ' || coalesce(string_agg(invoice_number, ', '), '')
  from (
    select invoice_number from public.invoices
    where issue_date > current_date + 1 or due_date < issue_date
    limit 20
  ) s

  -- ── Settings ──────────────────────────────────────────────────────────────
  union all
  select 'Settings', 'setting ' || k.key,
         case
           when s.key is null or coalesce(s.value #>> '{}', '') = '' then
             case when k.key in ('shop_name', 'shop_address', 'shop_gstin') then 'MISSING' else 'OK' end
           when k.key = 'shop_gstin'
             and (s.value #>> '{}') !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then 'PROBLEM'
           when k.key = 'shop_gstin' and (s.value #>> '{}') = '27AAAAA0000A1Z5' then 'PROBLEM'
           else 'OK'
         end,
         coalesce(s.value #>> '{}', 'not set')
  from (values ('shop_name'),('shop_address'),('shop_gstin'),('invoice_prefix'),
               ('invoice_start_num'),('shop_logo')) k(key)
  left join public.settings s on s.key = k.key

  -- ── Size (the old app silently stopped at 1000 rows) ─────────────────────
  union all
  select 'Size', 'rows in ' || x.tbl,
         case when x.n > 1000 then 'REVIEW' else 'OK' end,
         x.n || case when x.n > 1000 then ' — old reports/lists were truncated' else '' end
  from (
    select 'invoices' tbl, count(*) n from public.invoices
    union all select 'invoice_items', count(*) from public.invoice_items
    union all select 'products', count(*) from public.products
    union all select 'customers', count(*) from public.customers
    union all select 'payments', count(*) from public.payments
    union all select 'stock_movements', count(*) from public.stock_movements
  ) x
)
select section, item, status, detail
from checks
order by
  case status when 'PROBLEM' then 0 when 'MISSING' then 1 when 'REVIEW' then 2 else 3 end,
  section, item;

rollback;
