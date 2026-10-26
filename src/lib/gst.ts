import { round2 } from "@/lib/billing";

/** GST state codes (first two digits of a GSTIN). */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Validates the 15-character GSTIN format (not the checksum). */
export function isValidGstin(gstin: string): boolean {
  return GSTIN_PATTERN.test(gstin.trim().toUpperCase());
}

/** State code from a GSTIN, or null if missing/invalid. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  const match = gstin?.trim().match(/^([0-9]{2})/);
  return match && GST_STATE_CODES[match[1]] ? match[1] : null;
}

export function stateLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return `${GST_STATE_CODES[code] ?? "Unknown"} (${code})`;
}

export type SupplyType = "intra" | "inter";

/**
 * Determines intra-state (CGST + SGST) vs inter-state (IGST) supply. A
 * customer without a GSTIN is treated as a local counter sale.
 */
export function determineSupply(
  shopGstin: string | null | undefined,
  customerGstin: string | null | undefined
): { placeOfSupply: string | null; supplyType: SupplyType } {
  const shopState = stateCodeFromGstin(shopGstin);
  const placeOfSupply = stateCodeFromGstin(customerGstin) ?? shopState;
  const supplyType: SupplyType =
    shopState && placeOfSupply && placeOfSupply !== shopState ? "inter" : "intra";
  return { placeOfSupply, supplyType };
}

export interface TaxRateRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
}

/** Splits a tax amount into CGST/SGST halves (SGST takes any odd paisa). */
export function splitTax(tax: number): { cgst: number; sgst: number } {
  const cgst = round2(tax / 2);
  return { cgst, sgst: round2(tax - cgst) };
}

/** Rate-wise GST summary for the invoice print. */
export function taxBreakdown(
  items: { tax_rate: number; tax_amount: number; total_amount: number }[],
  supplyType: SupplyType
): TaxRateRow[] {
  const byRate = new Map<number, { taxable: number; tax: number }>();

  for (const item of items) {
    const rate = Number(item.tax_rate || 0);
    const tax = Number(item.tax_amount || 0);
    const taxable = Number(item.total_amount || 0) - tax;
    const entry = byRate.get(rate) ?? { taxable: 0, tax: 0 };
    entry.taxable += taxable;
    entry.tax += tax;
    byRate.set(rate, entry);
  }

  return Array.from(byRate.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, { taxable, tax }]) => {
      const totalTax = round2(tax);
      const { cgst, sgst } = supplyType === "intra" ? splitTax(totalTax) : { cgst: 0, sgst: 0 };
      return {
        rate,
        taxable: round2(taxable),
        cgst,
        sgst,
        igst: supplyType === "inter" ? totalTax : 0,
        totalTax,
      };
    });
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
