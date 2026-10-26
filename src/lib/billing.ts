/**
 * Billing math shared by the invoice, payment and report screens.
 *
 * Must stay in sync with public.create_invoice() in
 * supabase/migrations/20261026000000_security_and_atomic_billing.sql,
 * which recomputes these amounts on the server and is authoritative.
 */

/** Rounds to 2 decimals (half away from zero), cancelling float noise first. */
export function round2(value: number): number {
  const cents = Number((Math.abs(value) * 100).toPrecision(12));
  return (Math.sign(value) * Math.round(cents)) / 100;
}

/** Converts a rupee amount to integer paise for exact comparisons. */
export function toPaise(value: number): number {
  return Math.round(round2(value) * 100);
}

/** Clamps a numeric input into [min, max], mapping NaN to min. */
export function clampNumber(value: number, min: number, max = Infinity): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface LineInput {
  quantity: number;
  unit_price: number;
  discount_percentage: number;
  tax_rate: number;
}

export interface LineAmounts {
  /** quantity × unit_price */
  gross_amount: number;
  /** line-level discount */
  discount_amount: number;
  /** this line's share of the overall (invoice-level) discount */
  overall_discount_share: number;
  /** value GST is charged on: gross − line discount − overall discount share */
  taxable_amount: number;
  tax_amount: number;
  total_amount: number;
}

/**
 * Computes one line. The overall discount is applied to the taxable value
 * BEFORE GST, so GST is charged only on the discounted price.
 */
export function computeLineAmounts(
  line: LineInput,
  overallDiscountPct = 0
): LineAmounts {
  const gross_amount = round2(line.quantity * line.unit_price);
  const discount_amount = round2(gross_amount * (line.discount_percentage / 100));
  const net = round2(gross_amount - discount_amount);
  const overall_discount_share = round2(net * (overallDiscountPct / 100));
  const taxable_amount = round2(net - overall_discount_share);
  const tax_amount = round2(taxable_amount * (line.tax_rate / 100));
  const total_amount = round2(taxable_amount + tax_amount);

  return {
    gross_amount,
    discount_amount,
    overall_discount_share,
    taxable_amount,
    tax_amount,
    total_amount,
  };
}

export interface InvoiceTotals {
  /** sum of (gross − line discount), before the overall discount */
  subtotal: number;
  /** total overall discount */
  discount_amount: number;
  taxable_amount: number;
  tax_amount: number;
  total_amount: number;
}

export function computeInvoiceTotals(lines: LineAmounts[]): InvoiceTotals {
  const sum = (pick: (l: LineAmounts) => number) =>
    round2(lines.reduce((s, l) => s + pick(l), 0));

  return {
    subtotal: sum((l) => l.gross_amount - l.discount_amount),
    discount_amount: sum((l) => l.overall_discount_share),
    taxable_amount: sum((l) => l.taxable_amount),
    tax_amount: sum((l) => l.tax_amount),
    total_amount: sum((l) => l.total_amount),
  };
}

export type PaymentStatus = "paid" | "partially_paid" | "due";

/** Status from amounts, compared in paise so float noise can't leave ₹0.00 due. */
export function computePaymentStatus(total: number, paid: number): PaymentStatus {
  const totalP = toPaise(total);
  const paidP = toPaise(paid);
  if (paidP >= totalP) return "paid";
  if (paidP > 0) return "partially_paid";
  return "due";
}

/** Timezone used where there's no browser (server rendering). */
export const APP_TIME_ZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata";

/**
 * YYYY-MM-DD for a calendar date — in the browser's local timezone by
 * default, or in `timeZone` when given. Never UTC (toISOString would shift
 * dates before 05:30 IST to the previous day).
 */
export function localDateString(date: Date = new Date(), timeZone?: string): string {
  if (timeZone) {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
