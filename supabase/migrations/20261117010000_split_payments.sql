-- Split payments on a new invoice (e.g. ₹200 UPI + ₹300 Cash).
--
-- Adds an overload of create_invoice() that takes p_payments, a JSON array of
-- {"method": "cash" | "upi", "amount": 123.45}. The original 9-argument
-- create_invoice() is left untouched, so the app keeps working before and
-- after this migration is applied.
--
-- How it works, all in one transaction:
--   1. the existing create_invoice() builds the invoice, items and stock
--      movements with nothing paid;
--   2. record_payment() then adds one payment row per method, which also
--      updates amount_paid and the status (paid / partially_paid).
-- Any error (e.g. payments larger than the total) rolls everything back.
--
-- Each payment row keeps its own method, so Cash and UPI balances and the
-- finance ledger pick up each part separately.
--
-- Safe to run more than once. Changes no existing data.
-- Rollback: drop function if exists public.create_invoice(uuid, boolean, date, date, numeric, text, jsonb, jsonb);

create or replace function public.create_invoice(
  p_customer_id uuid,
  p_is_draft boolean,
  p_issue_date date,
  p_due_date date,
  p_overall_discount_pct numeric,
  p_notes text,
  p_items jsonb,
  p_payments jsonb
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_payment jsonb;
  v_method text;
  v_amount numeric;
  v_count int := 0;
  v_res jsonb;
  v_invoice_id uuid;
  v_invoice_number text;
  v_status text;
  v_paid numeric;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorised';
  end if;

  if p_payments is null then
    p_payments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payments must be a list.';
  end if;

  -- Validate every payment line before anything is written
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    v_method := lower(trim(coalesce(v_payment->>'method', '')));
    v_amount := round(coalesce((v_payment->>'amount')::numeric, 0), 2);

    if v_method not in ('cash', 'upi') then
      raise exception 'Payment method must be Cash or UPI.';
    end if;
    if v_amount < 0 then
      raise exception 'Payment amounts cannot be negative.';
    end if;
    if v_amount > 0 then
      v_count := v_count + 1;
    end if;
  end loop;

  if p_is_draft and v_count > 0 then
    raise exception 'A draft invoice cannot have a payment.';
  end if;

  -- 1. Invoice, items and stock, with nothing paid yet
  v_res := public.create_invoice(
    p_customer_id, p_is_draft, p_issue_date, p_due_date,
    p_overall_discount_pct, 0::numeric, null::text, p_notes, p_items
  );
  v_invoice_id := (v_res->>'id')::uuid;
  v_invoice_number := v_res->>'invoice_number';

  select coalesce(sum(round(coalesce((e->>'amount')::numeric, 0), 2)), 0)
    into v_paid from jsonb_array_elements(p_payments) e;
  if v_paid > (v_res->>'total_amount')::numeric then
    raise exception 'Payments (%) cannot exceed the invoice total (%).', v_paid, v_res->>'total_amount';
  end if;

  -- 2. One payment row per method (zero amounts are skipped).
  --    record_payment() locks the invoice, rejects anything above the
  --    outstanding balance and updates amount_paid and status.
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    v_method := lower(trim(v_payment->>'method'));
    v_amount := round(coalesce((v_payment->>'amount')::numeric, 0), 2);
    continue when v_amount = 0;

    perform public.record_payment(
      v_invoice_id, v_amount, v_method, p_issue_date,
      'Initial payment for Invoice #' || v_invoice_number ||
        case when v_count > 1 then ' (' || upper(v_method) || ')' else '' end
    );
  end loop;

  select status::text, amount_paid into v_status, v_paid
    from invoices where id = v_invoice_id;

  return v_res || jsonb_build_object('status', v_status, 'amount_paid', v_paid);
end;
$function$;

revoke all on function public.create_invoice(uuid, boolean, date, date, numeric, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_invoice(uuid, boolean, date, date, numeric, text, jsonb, jsonb) to authenticated;
