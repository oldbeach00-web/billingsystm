-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20261117000000_finance_modules.sql
--
-- Removes ONLY the finance modules (accounts, income & expenses, salaries,
-- suppliers, transfers and their views/functions). Invoices, payments,
-- customers, products and stock are not touched.
--
-- BEFORE RUNNING: export the finance data you want to keep
-- (Supabase → Table Editor → each table → Export → CSV):
--   finance_accounts, finance_default_accounts, finance_entries, staff,
--   salary_payments, suppliers, supplier_bills, supplier_payments,
--   account_transfers
-- AFTER RUNNING: revert the PR #11 merge and redeploy, because the finance
-- pages need these tables.
-- ════════════════════════════════════════════════════════════════════════════

begin;

drop view if exists public.unassigned_customer_payments;
drop view if exists public.account_balances;
drop view if exists public.supplier_balances;
drop view if exists public.money_ledger;

drop function if exists public.set_default_account(uuid);
drop function if exists public.pay_supplier(uuid, uuid, numeric, text, uuid, date, text, text);
drop function if exists public.delete_supplier_payment(uuid);
drop function if exists public.cancel_supplier_bill(uuid);

-- Tables (their triggers go with them); children before parents
drop table if exists public.supplier_payments;
drop table if exists public.supplier_bills;
drop table if exists public.suppliers;
drop table if exists public.salary_payments;
drop table if exists public.staff;
drop table if exists public.finance_entries;
drop table if exists public.account_transfers;
drop table if exists public.finance_default_accounts;
drop table if exists public.finance_accounts;

drop function if exists public.finance_set_created_by();
drop function if exists public.finance_check_account();
drop function if exists public.finance_check_transfer();
drop function if exists public.finance_guard_account();
drop function if exists public.finance_guard_bill();
drop function if exists public.finance_guard_supplier_payment();
drop function if exists public.finance_guard_default_history();

commit;
