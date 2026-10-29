-- ════════════════════════════════════════════════════════════════════════════
-- Remove GST from new invoices
--
-- Run AFTER 20261026000100_gst_details_and_cancellation.sql (back up first).
--
-- create_invoice() no longer charges tax: any tax_rate sent by a client is
-- ignored, new invoices and items store tax_rate = 0 / tax_amount = 0, and no
-- HSN/SAC or place-of-supply snapshot is taken.
--
-- Nothing is dropped or rewritten. The GST columns (products.tax_rate,
-- products.hsn_sac, customers.gstin, invoices.tax_amount / place_of_supply /
-- supply_type, invoice_items.tax_rate / tax_amount / hsn_sac) and the
-- shop_gstin setting stay as they are, so every invoice issued before this
-- change keeps its stored amounts and still prints its original total.
--
-- Safe to run before or after deploying the matching app version: the app no
-- longer sends tax_rate, which the previous create_invoice() treated as 0.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── create_invoice (no tax) ───────────────────────────────────────────────
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
  v_gross numeric;
  v_line_disc numeric;
  v_net numeric;
  v_share numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_overall_disc numeric := 0;
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

    v_gross := round(v_qty * v_price, 2);
    v_line_disc := round(v_gross * v_disc_pct / 100, 2);
    v_net := v_gross - v_line_disc;
    v_share := round(v_net * p_overall_discount_pct / 100, 2);
    v_line_total := v_net - v_share;

    v_subtotal := v_subtotal + v_net;
    v_overall_disc := v_overall_disc + v_share;
    v_total := v_total + v_line_total;

    v_lines := v_lines || jsonb_build_object(
      'product_id', nullif(v_item->>'product_id', ''),
      'description', trim(v_item->>'description'),
      'quantity', v_qty,
      'unit_price', v_price,
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
    v_subtotal, 0, v_overall_disc, v_total, v_paid,
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
    0, 0,
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

commit;
