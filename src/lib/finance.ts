/* eslint-disable @typescript-eslint/no-explicit-any */
import { db, fetchAllRows } from "@/lib/db";
import { round2 } from "@/lib/billing";

/**
 * Shared types and helpers for the finance modules (income & expenses,
 * profit & loss, staff salaries, bank & payment accounts, suppliers).
 * Tables and views are created by
 * supabase/migrations/20261117000000_finance_modules.sql.
 */

export type PaymentMode = "cash" | "upi" | "bank";

export const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank" },
];

export function modeLabel(mode: string): string {
  return PAYMENT_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** Active accounts that can be used for a payment mode. */
export function accountsFor(accounts: FinanceAccount[], mode: PaymentMode): FinanceAccount[] {
  return accounts.filter((a) => a.kind === mode && a.is_active);
}

/**
 * Account to pre-select for a mode: the default Cash / UPI account. Bank is
 * never pre-selected — the accountant must choose the bank account.
 */
export function initialAccountId(accounts: FinanceAccount[], mode: PaymentMode): string {
  if (mode === "bank") return "";
  return accountsFor(accounts, mode).find((a) => a.is_default)?.id ?? "";
}

export interface FinanceAccount {
  id: string;
  name: string;
  kind: PaymentMode;
  bank_name: string | null;
  account_number: string | null;
  ifsc: string | null;
  upi_id: string | null;
  opening_balance: number;
  is_default: boolean;
  is_active: boolean;
  notes: string | null;
}

export interface AccountBalance {
  id: string;
  name: string;
  kind: PaymentMode;
  opening_balance: number;
  is_default: boolean;
  is_active: boolean;
  total_in: number;
  total_out: number;
  balance: number;
}

export interface FinanceEntry {
  id: string;
  entry_type: "income" | "expense";
  entry_date: string;
  category: string;
  description: string | null;
  amount: number;
  payment_mode: PaymentMode;
  account_id: string | null;
  reference: string | null;
}

export interface Staff {
  id: string;
  name: string;
  phone: string | null;
  designation: string | null;
  monthly_salary: number;
  joining_date: string | null;
  is_active: boolean;
  notes: string | null;
}

export interface SalaryPayment {
  id: string;
  staff_id: string;
  salary_month: string;
  payment_date: string;
  amount: number;
  payment_mode: PaymentMode;
  account_id: string | null;
  notes: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  opening_balance: number;
  is_active: boolean;
  notes: string | null;
}

export interface SupplierBalance {
  id: string;
  name: string;
  opening_balance: number;
  total_billed: number;
  total_paid: number;
  outstanding: number;
}

export interface SupplierBill {
  id: string;
  supplier_id: string;
  bill_number: string | null;
  bill_date: string;
  due_date: string | null;
  amount: number;
  amount_paid: number;
  amount_due: number;
  status: "unpaid" | "partially_paid" | "paid" | "cancelled";
  notes: string | null;
}

export interface SupplierPayment {
  id: string;
  supplier_id: string;
  supplier_bill_id: string | null;
  payment_date: string;
  amount: number;
  payment_mode: PaymentMode;
  account_id: string | null;
  reference: string | null;
  notes: string | null;
}

export interface AccountTransfer {
  id: string;
  transfer_date: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  notes: string | null;
}

export type LedgerSource =
  | "customer_payment"
  | "customer_refund"
  | "income"
  | "expense"
  | "salary"
  | "supplier_payment"
  | "transfer_in"
  | "transfer_out";

export interface LedgerRow {
  entry_date: string;
  source: LedgerSource;
  direction: 1 | -1;
  amount: number;
  mode: PaymentMode;
  /** Account the money moved through, fixed when it was recorded */
  account_id: string | null;
  description: string;
  party: string;
  source_id: string;
}

/**
 * Query builder for the finance tables. They aren't in the generated
 * Database type, so the builder is untyped; rows are cast at the call site.
 */
export function fdb(table: string): any {
  return db.from(table) as any;
}

// Unique column(s) used as a tie-breaker so paging is stable. Views without
// an "id" column need their own key.
const TIEBREAK: Record<string, string[]> = {
  money_ledger: ["source", "source_id"],
  unassigned_customer_payments: ["payment_id"],
};

/** Loads every row of a finance table or view (no 1000-row cap). */
export async function loadAll<T>(
  table: string,
  order: string,
  ascending = true,
  build?: (q: any) => any
): Promise<T[]> {
  const { data, error } = await fetchAllRows<T>(() => {
    const q = fdb(table).select("*");
    let ordered = (build ? build(q) : q).order(order, { ascending });
    for (const key of TIEBREAK[table] ?? ["id"]) ordered = ordered.order(key);
    return ordered;
  });
  if (error) throw new Error(error.message);
  return data.map((row) => normaliseNumbers(row));
}

/** Supabase returns numeric columns as numbers or strings; make them numbers. */
function normaliseNumbers<T>(row: T): T {
  const out = { ...(row as Record<string, unknown>) };
  for (const key of [
    "amount", "amount_paid", "amount_due", "opening_balance", "monthly_salary",
    "balance", "total_in", "total_out", "total_billed", "total_paid",
    "outstanding", "direction", "total_amount",
  ]) {
    if (key in out && out[key] !== null) out[key] = Number(out[key]);
  }
  return out as T;
}

/** Throws a readable error for a failed Supabase write. */
export function check(error: { message?: string; code?: string } | null, what: string): void {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202") {
    throw new Error(
      `${what}: the finance tables are missing. Apply supabase/migrations/20261117000000_finance_modules.sql first.`
    );
  }
  throw new Error(error.message || what);
}

/** First day of a month as YYYY-MM-DD, from YYYY-MM. */
export function monthStart(yyyyMm: string): string {
  return `${yyyyMm}-01`;
}

export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function inRange(date: string, from: string, to: string): boolean {
  return (!from || date >= from) && (!to || date <= to);
}

export const INCOME_CATEGORIES = [
  "Commission", "Interest", "Rent received", "Scrap sale", "Service charges", "Other income",
];

export const EXPENSE_CATEGORIES = [
  "Rent", "Electricity", "Water", "Internet & phone", "Transport", "Fuel",
  "Repairs & maintenance", "Packing material", "Stationery", "Tea & refreshments",
  "Cleaning", "Bank charges", "Taxes & fees", "Advertising", "Other expense",
];

export interface ProfitAndLoss {
  /** Customer payments received, before refunds */
  salesReceived: number;
  /** Refunds paid back on cancelled invoices */
  refunds: number;
  /** salesReceived − refunds */
  salesCollected: number;
  otherIncome: number;
  totalIncome: number;
  supplierPayments: number;
  salaries: number;
  expenses: number;
  expenseByCategory: { category: string; amount: number }[];
  totalExpenses: number;
  netProfit: number;
  byMode: { mode: PaymentMode; moneyIn: number; moneyOut: number; net: number }[];
}

/**
 * Cash-basis profit & loss: money actually received and paid in the period,
 * optionally for one payment mode. Transfers between your own accounts are
 * not income or expense, so they are left out. Refunds reduce sales in the
 * period they were paid back. Supplier payments count as expenses when paid
 * (stock still on hand is not valued).
 */
export function computeProfitAndLoss(
  ledger: LedgerRow[],
  entries: FinanceEntry[],
  from: string,
  to: string,
  mode: PaymentMode | "all"
): ProfitAndLoss {
  const rows = ledger.filter(
    (r) =>
      inRange(r.entry_date, from, to) &&
      (mode === "all" || r.mode === mode) &&
      r.source !== "transfer_in" &&
      r.source !== "transfer_out"
  );
  const sum = (source: LedgerSource) =>
    round2(rows.filter((r) => r.source === source).reduce((s, r) => s + r.amount, 0));

  const salesReceived = sum("customer_payment");
  const refunds = sum("customer_refund");
  const salesCollected = round2(salesReceived - refunds);
  const otherIncome = sum("income");
  const supplierPayments = sum("supplier_payment");
  const salaries = sum("salary");
  const expenses = sum("expense");

  const categories = new Map<string, number>();
  for (const e of entries) {
    if (e.entry_type !== "expense") continue;
    if (!inRange(e.entry_date, from, to) || (mode !== "all" && e.payment_mode !== mode)) continue;
    categories.set(e.category, round2((categories.get(e.category) ?? 0) + e.amount));
  }

  const totalIncome = round2(salesCollected + otherIncome);
  const totalExpenses = round2(supplierPayments + salaries + expenses);

  const byMode = PAYMENT_MODES.map(({ value }) => {
    const modeRows = rows.filter((r) => r.mode === value);
    const moneyIn = round2(modeRows.filter((r) => r.direction > 0).reduce((s, r) => s + r.amount, 0));
    const moneyOut = round2(modeRows.filter((r) => r.direction < 0).reduce((s, r) => s + r.amount, 0));
    return { mode: value, moneyIn, moneyOut, net: round2(moneyIn - moneyOut) };
  });

  return {
    salesReceived,
    refunds,
    salesCollected,
    otherIncome,
    totalIncome,
    supplierPayments,
    salaries,
    expenses,
    expenseByCategory: Array.from(categories, ([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    totalExpenses,
    netProfit: round2(totalIncome - totalExpenses),
    byMode,
  };
}
