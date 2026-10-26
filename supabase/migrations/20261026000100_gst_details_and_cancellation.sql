-- ════════════════════════════════════════════════════════════════════════════
-- GST invoice details + invoice cancellation
--
-- Run AFTER 20261026000000_security_and_atomic_billing.sql (back up first).
--
--   • invoice_items.hsn_sac   — HSN/SAC snapshot taken at the time of sale
--   • invoices.place_of_supply — 2-digit GST state code of the place of supply
--   • invoices.supply_type     — 'intra' (CGST + SGST) or 'inter' (IGST)
--   • create_invoice() now fills those three columns
--   • next_invoice_number() starts a new financial-year series at the
--     "invoice start number" from Settings
--   • cancel_invoice() voids an invoice, restores stock and marks any
--     payments as refunded, in one transaction
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.invoice_items add column if not exists hsn_sac text;
alter table public.invoices add column if not exists place_of_supply text;
alter table public.invoices add column if not exists supply_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_supply_type_check'
  ) then
    alter table public.invoices
      add constraint invoices_supply_type_check
      check (supply_type is null or supply_type in ('intra', 'inter'));
  end if;
end $$;

-- Backfill HSN for existing items from the product's current code (best
-- available; old invoices had no snapshot)
update public.invoice_items i
   set hsn_sac = p.hsn_sac
  from public.products p
 where i.product_id = p.id and i.hsn_sac is null;

-- ─── next_invoice_number (honours the "invoice start number" setting) ──────

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
  v_start integer := 1;
  v_number text;
begin
  if p_is_draft then
    v_prefix := 'DRAFT-';
  else
    select coalesce(nullif(regexp_replace(value #>> '{}', '[^A-Za-z0-9/-]', '', 'g'), ''), 'INV-')
      into v_prefix
      from settings where key = 'invoice_prefix';
    v_prefix := coalesce(v_prefix, 'INV-');

    -- First number of a new series (Settings → invoice start number)
    select greatest(coalesce(nullif(regexp_replace(value #>> '{}', '[^0-9]', '', 'g'), '')::integer, 1), 1)
      into v_start
      from settings where key = 'invoice_start_num';
    v_start := coalesce(v_start, 1);
  end if;

  v_fy_start := extract(year from p_issue_date)::integer
    - case when extract(month from p_issue_date) < 4 then 1 else 0 end;

  v_series := v_prefix || lpad((v_fy_start % 100)::text, 2, '0')
    || lpad(((v_fy_start + 1) % 100)::text, 2, '0') || '-';

  insert into invoice_sequences (series, last_number)
  values (v_series, v_start)
  on conflict (series) do update set last_number = invoice_sequences.last_number + 1
  returning last_number into v_next;

  v_number := v_series || lpad(v_next::text, 5, '0');

  if length(v_number) > 16 then
    raise exception 'Invoice number "%" is longer than 16 characters. Shorten the invoice prefix in Settings.', v_number;
  end if;

  return v_number;
end;
$$;

-- ─── create_invoice (adds HSN + place-of-supply snapshot) ──────────────────
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
  v_hsn text;
  v_shop_state text;
  v_customer_state text;
  v_supply_type text;
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

    -- Snapshot the HSN/SAC code so later product edits don't change old invoices
    v_hsn := null;
    if nullif(v_item->>'product_id', '') is not null then
      select hsn_sac into v_hsn from products where id = (v_item->>'product_id')::uuid;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'product_id', nullif(v_item->>'product_id', ''),
      'hsn_sac', v_hsn,
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

  -- Place of supply: the first two digits of a GSTIN are the state code.
  -- Customer without a GSTIN (B2C counter sale) => supply within the shop's state.
  select nullif(substring(value #>> '{}' from '^\s*([0-9]{2})'), '')
    into v_shop_state
    from settings where key = 'shop_gstin';
  select nullif(substring(gstin from '^\s*([0-9]{2})'), '')
    into v_customer_state
    from customers where id = p_customer_id;

  v_customer_state := coalesce(v_customer_state, v_shop_state);
  v_supply_type := case
    when v_shop_state is not null and v_customer_state <> v_shop_state then 'inter'
    else 'intra'
  end;

  v_invoice_number := public.next_invoice_number(p_issue_date, p_is_draft);

  insert into invoices (
    invoice_number, customer_id, status, issue_date, due_date,
    subtotal, tax_amount, discount_amount, total_amount, amount_paid,
    notes, created_by, place_of_supply, supply_type
  ) values (
    v_invoice_number, p_customer_id, v_status::invoice_status, p_issue_date, p_due_date,
    v_subtotal, v_tax_total, v_overall_disc, v_total, v_paid,
    nullif(p_notes, ''), v_user, v_customer_state, v_supply_type
  )
  returning id into v_invoice_id;

  insert into invoice_items (
    invoice_id, product_id, hsn_sac, description, quantity, unit_price,
    tax_rate, tax_amount, discount_percentage, discount_amount, total_amount
  )
  select
    v_invoice_id, (l->>'product_id')::uuid, l->>'hsn_sac', l->>'description',
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

-- ─── cancel_invoice ────────────────────────────────────────────────────────

create or replace function public.cancel_invoice(
  p_invoice_id uuid,
  p_reason text,
  p_refund_payments boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv record;
  v_stock record;
  v_before numeric;
  v_refunded numeric := 0;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Enter a reason for cancelling the invoice.';
  end if;

  select id, invoice_number, status::text as status, amount_paid, notes
    into v_inv
    from invoices where id = p_invoice_id for update;

  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'Invoice #% is already cancelled.', v_inv.invoice_number;
  end if;
  if v_inv.amount_paid > 0 and not coalesce(p_refund_payments, false) then
    raise exception 'Invoice #% has payments of %. Confirm that they have been refunded to cancel it.',
      v_inv.invoice_number, v_inv.amount_paid;
  end if;

  -- Drafts never deducted stock, so only issued invoices restore it
  if v_inv.status <> 'draft' then
    for v_stock in
      select product_id, sum(quantity) as qty
      from invoice_items
      where invoice_id = p_invoice_id and product_id is not null
      group by product_id
      order by product_id
    loop
      select stock_quantity into v_before
        from products where id = v_stock.product_id for update;

      if found then
        update products set stock_quantity = v_before + v_stock.qty
         where id = v_stock.product_id;

        insert into stock_movements (
          product_id, movement_type, quantity, quantity_before, quantity_after,
          reference_id, reference_type, notes, created_by
        ) values (
          v_stock.product_id, 'return'::stock_movement_type, v_stock.qty,
          v_before, v_before + v_stock.qty, p_invoice_id, 'invoice_cancel',
          'Cancelled Invoice #' || v_inv.invoice_number, auth.uid()
        );
      end if;
    end loop;
  end if;

  if v_inv.amount_paid > 0 then
    v_refunded := v_inv.amount_paid;
    update payments set status = 'refunded'::payment_status
     where invoice_id = p_invoice_id and status = 'completed'::payment_status;
  end if;

  update invoices
     set status = 'cancelled'::invoice_status,
         amount_paid = 0,
         notes = concat_ws(E'\n', nullif(v_inv.notes, ''), 'CANCELLED: ' || trim(p_reason))
   where id = p_invoice_id;

  return jsonb_build_object(
    'invoice_number', v_inv.invoice_number,
    'refunded', v_refunded
  );
end;
$$;

revoke all on function public.cancel_invoice(uuid, text, boolean) from public, anon;
grant execute on function public.cancel_invoice(uuid, text, boolean) to authenticated;

commit;
