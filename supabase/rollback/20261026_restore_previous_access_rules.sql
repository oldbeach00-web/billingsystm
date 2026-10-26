-- ════════════════════════════════════════════════════════════════════════════
-- EMERGENCY ROLLBACK for 20261026000000_security_and_atomic_billing.sql
--
-- Restores the access rules exactly as captured from the live project on
-- 2026-10-26 before the security migration. WARNING: this RE-OPENS the
-- security holes (public read of all tables, anonymous invoice creation).
-- Use only if the app is unusable and you need the old behaviour back.
-- It leaves the new tables/functions in place (they are harmless).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Remove the new admin-only policies
do $$
declare t text;
begin
  foreach t in array array['app_admins','user_profiles','categories','products','customers',
    'invoices','invoice_items','payments','stock_movements','settings','notifications','invoice_sequences']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists admin_all on public.%I', t);
      execute format('drop policy if exists admin_read on public.%I', t);
    end if;
  end loop;
end $$;

-- Previous policies
create policy "Admins/managers can manage categories" on public.categories as PERMISSIVE for ALL to authenticated using ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role]))) with check ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role])));
create policy "Strict_Anon_Read_Categories" on public.categories as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_Categories" on public.categories as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "Admins/managers/staff can manage customers" on public.customers as PERMISSIVE for ALL to authenticated using ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role]))) with check ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role])));
create policy "Strict_Anon_Read_Customers" on public.customers as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_Customers" on public.customers as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "Admins/managers/staff can manage invoice_items" on public.invoice_items as PERMISSIVE for ALL to authenticated using ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role]))) with check ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role])));
create policy "Strict_Anon_Read_InvoiceItems" on public.invoice_items as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_InvoiceItems" on public.invoice_items as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "Admins/managers/staff can manage invoices" on public.invoices as PERMISSIVE for ALL to authenticated using ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role]))) with check ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role])));
create policy "Strict_Anon_Read_Invoices" on public.invoices as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_Invoices" on public.invoices as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "Users can insert their own notifications" on public.notifications as PERMISSIVE for INSERT to authenticated with check ((auth.uid() = user_id));
create policy "Users can update their own notifications" on public.notifications as PERMISSIVE for UPDATE to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "Users can view their own notifications" on public.notifications as PERMISSIVE for SELECT to authenticated using ((auth.uid() = user_id));
create policy "Admins/managers/staff can manage payments" on public.payments as PERMISSIVE for ALL to authenticated using ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role]))) with check ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role])));
create policy "Strict_Anon_Read_Payments" on public.payments as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_Payments" on public.payments as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "Admins/managers/staff can manage products" on public.products as PERMISSIVE for ALL to authenticated using ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role]))) with check ((current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'staff'::user_role])));
create policy "Strict_Anon_Read_Products" on public.products as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_Products" on public.products as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "Only admins can manage settings" on public.settings as PERMISSIVE for ALL to authenticated using ((current_user_role() = 'admin'::user_role)) with check ((current_user_role() = 'admin'::user_role));
create policy "Strict_Anon_Read_Settings" on public.settings as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_Settings" on public.settings as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "Strict_Anon_Read_Stock" on public.stock_movements as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_Stock" on public.stock_movements as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy "Strict_Anon_Read_Profiles" on public.user_profiles as PERMISSIVE for SELECT to anon using (true);
create policy "Strict_Auth_Full_Profiles" on public.user_profiles as PERMISSIVE for ALL to authenticated using (true) with check (true);

-- Previous anon table grants
grant insert, select, update, delete, truncate, references, trigger on
  public.categories, public.customers, public.invoice_items, public.invoices,
  public.notifications, public.payments, public.products, public.settings,
  public.stock_movements, public.user_profiles
to anon;

-- Previous function grants
grant execute on function public.confirm_invoice_transaction(text, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, text, text, uuid, jsonb) to public, anon, authenticated;
grant execute on function public.confirm_invoice_transaction(text, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, text, text, uuid, jsonb, text) to public, anon, authenticated;

commit;
