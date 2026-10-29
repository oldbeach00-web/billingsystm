/**
 * Billing math shared by the invoice, payment and report screens.
 *
 * Must stay in sync with public.create_invoice() in
 * supabase/migrations/20261029000000_remove_gst.sql,
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
}

export interface LineAmounts {
  /** quantity × unit_price */
  gross_amount: number;
  /** line-level discount */
  discount_amount: number;
  /** this line's share of the overall (invoice-level) discount */
  overall_discount_share: number;
  /** gross − line discount − overall discount share (no tax is charged) */
  total_amount: number;
}

/** Computes one line: line discount first, then its share of the overall discount. */
export function computeLineAmounts(
  line: LineInput,
  overallDiscountPct = 0
): LineAmounts {
  const gross_amount = round2(line.quantity * line.unit_price);
  const discount_amount = round2(gross_amount * (line.discount_percentage / 100));
  const net = round2(gross_amount - discount_amount);
  const overall_discount_share = round2(net * (overallDiscountPct / 100));
  const total_amount = round2(net - overall_discount_share);

  return {
    gross_amount,
    discount_amount,
    overall_discount_share,
    total_amount,
  };
}

export interface InvoiceTotals {
  /** sum of (gross − line discount), before the overall discount */
  subtotal: number;
  /** total overall discount */
  discount_amount: number;
  total_amount: number;
}

export function computeInvoiceTotals(lines: LineAmounts[]): InvoiceTotals {
  const sum = (pick: (l: LineAmounts) => number) =>
    round2(lines.reduce((s, l) => s + pick(l), 0));

  return {
    subtotal: sum((l) => l.gross_amount - l.discount_amount),
    discount_amount: sum((l) => l.overall_discount_share),
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

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""]
    .filter(Boolean)
    .join(" ");
}

/** Whole number in Indian numbering words (crore / lakh / thousand). */
function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerToWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** e.g. 1062.5 → "Rupees One Thousand Sixty Two and Fifty Paise Only" */
export function amountInWords(amount: number): string {
  const paiseTotal = Math.round(round2(Math.abs(amount)) * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  return `Rupees ${integerToWords(rupees)}${
    paise ? ` and ${belowHundred(paise)} Paise` : ""
  } Only`;
}
