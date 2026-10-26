-- ════════════════════════════════════════════════════════════════════════════
-- Lock down legacy helper functions (Supabase security advisor warnings)
--
--   • current_user_role / handle_new_user were callable through the public API
--     as SECURITY DEFINER functions. The app no longer uses current_user_role
--     (its policies were replaced), and trigger functions don't need EXECUTE
--     for triggers to fire, so callers lose nothing.
--   • Pins search_path on the remaining functions that lacked it.
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('current_user_role', 'handle_new_user', 'set_updated_at',
                        'invoices_set_amount_due', 'confirm_invoice_transaction')
  loop
    execute format('alter function %s set search_path = public', f.sig);
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

commit;
