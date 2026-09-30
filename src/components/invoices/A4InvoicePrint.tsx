"use client";

import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/db";
import { X, Printer } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type {
  Invoice,
  Customer,
  InvoiceItem,
  Product,
} from "@/types/database";

export interface ShopDetails {
  name: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  footer?: string;
  terms?: string;
}

export const DEFAULT_SHOP_DETAILS: ShopDetails = {
  name: "BILLING & INVENTORY SYSTEM",
  address: "123 Commercial Street, Business Hub, City - 400001",
  phone: "+91 98765 43210",
  email: "billing@example.com",
  gstin: "27AAAAA0000A1Z5",
  footer: "Thank you for your business!",
  terms:
    "1. Goods once sold will not be taken back or exchanged.\n2. Payment is due within agreed payment terms.",
};

interface A4InvoicePrintProps {
  invoice: Invoice & {
    customer?: Customer;
    items?: (InvoiceItem & { product?: Product })[];
  };
  shopDetails?: ShopDetails;
  onClose: () => void;
}

type SettingRow = {
  key: string;
  value: string | number;
};

export function A4InvoicePrint({
  invoice,
  shopDetails: initialShopDetails,
  onClose,
}: A4InvoicePrintProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const [shopDetails, setShopDetails] = useState<ShopDetails>(
    initialShopDetails || DEFAULT_SHOP_DETAILS
  );

  useEffect(() => {
    const loadShopDetails = async () => {
      const result = await db.from("settings").select("*");

      const data = result.data as SettingRow[] | null;

      if (data && data.length > 0) {
        const settingsMap: Record<string, string | number> = {};

        data.forEach((row) => {
          settingsMap[String(row.key)] = row.value;
        });

        setShopDetails({
          name: String(
            settingsMap.shop_name || DEFAULT_SHOP_DETAILS.name
          ),
          address: String(
            settingsMap.shop_address || DEFAULT_SHOP_DETAILS.address
          ),
          phone: String(
            settingsMap.shop_phone || DEFAULT_SHOP_DETAILS.phone
          ),
          email: String(
            settingsMap.shop_email || DEFAULT_SHOP_DETAILS.email
          ),
          gstin: String(
            settingsMap.shop_gstin || DEFAULT_SHOP_DETAILS.gstin
          ),
          footer:
            settingsMap.invoice_footer != null
              ? String(settingsMap.invoice_footer)
              : DEFAULT_SHOP_DETAILS.footer,
          terms:
            settingsMap.terms_and_conditions != null
              ? String(settingsMap.terms_and_conditions)
              : DEFAULT_SHOP_DETAILS.terms,
        });
      }
    };

    void loadShopDetails();
  }, []);

  const handlePrint = () => {
    if (!printRef.current) return;

    const printContents = printRef.current.innerHTML;

    const win = window.open(
      "",
      "_blank",
      "width=900,height=700"
    );

    if (!win) return;

    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice_${invoice.invoice_number}</title>
          <style>
            @page { size: A4; margin: 15mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #1f2937; padding: 20px; line-height: 1.4; }
            .header-table { width: 100%; border-bottom: 2px solid #4f46e5; padding-bottom: 15px; margin-bottom: 20px; }
            .shop-title { font-size: 20px; font-weight: bold; color: #4f46e5; text-transform: uppercase; }
            .inv-title { font-size: 24px; font-weight: bold; color: #111827; text-align: right; letter-spacing: 0.05em; }
            .details-grid { width: 100%; margin-bottom: 20px; }
            .box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; }
            .box-title { font-size: 10px; font-weight: bold; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; }
            table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            table.items th { background: #4f46e5; color: #ffffff; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; }
            table.items td { padding: 10px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
            table.items tr:nth-child(even) { background: #f9fafb; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .totals-table { width: 320px; margin-left: auto; margin-bottom: 20px; font-size: 12px; }
            .totals-table td { padding: 4px 8px; }
            .total-row { font-weight: bold; font-size: 14px; border-top: 2px solid #111827; border-bottom: 2px solid #111827; }
            .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
            .badge-paid { background: #d1fae5; color: #065f46; }
            .badge-partial { background: #fef3c7; color: #92400e; }
            .badge-due { background: #fee2e2; color: #991b1b; }
            .footer { margin-top: 30px; border-top: 1px solid #e5e7eb; pt: 15px; font-size: 10px; color: #6b7280; width: 100%; }
            .sig-box { text-align: right; margin-top: 40px; }
          </style>
        </head>
        <body>
          ${printContents}
        </body>
      </html>
    `);

    win.document.close();
    win.focus();

    setTimeout(() => {
      win.print();
      win.close();
    }, 250);
  };

  const status = invoice.status || "due";

  const statusLabel =
    status === "paid"
      ? "PAID"
      : status === "partially_paid"
      ? "PARTIALLY PAID"
      : status === "sent" || status === "due"
      ? "DUE"
      : status.toUpperCase();

  const paidAmt = Number(invoice.amount_paid || 0);
  const totalAmt = Number(invoice.total_amount || 0);

  const balanceAmt = Number(
    invoice.amount_due ??
      Math.max(0, totalAmt - paidAmt)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Modal Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Invoice #{invoice.invoice_number}
            </h3>

            <span
              className={cn(
                "px-2.5 py-0.5 rounded-full text-xs font-bold uppercase",
                status === "paid" &&
                  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
                status === "partially_paid" &&
                  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                (status === "due" || status === "sent") &&
                  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
              )}
            >
              {statusLabel}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow"
            >
              <Printer className="w-4 h-4" />
              Print / Reprint Invoice
            </button>

            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* A4 Document Wrapper */}
        <div className="overflow-y-auto flex-1 p-6 bg-gray-100 dark:bg-gray-950 flex justify-center">
          <div
            ref={printRef}
            className="bg-white text-gray-900 w-full max-w-[210mm] p-8 shadow-xl rounded-lg border border-gray-200 space-y-6"
            style={{ minHeight: "297mm" }}
          >
            {/* Header: Shop Details & Title */}
            <div className="flex justify-between items-start border-b-2 border-indigo-600 pb-4">
              <div>
                <h1 className="text-2xl font-black text-indigo-600 tracking-wide uppercase">
                  {shopDetails.name}
                </h1>

                <p className="text-xs text-gray-600 mt-1 max-w-sm">
                  {shopDetails.address}
                </p>

                <p className="text-xs text-gray-600">
                  Phone: {shopDetails.phone} | Email:{" "}
                  {shopDetails.email}
                </p>

                <p className="text-xs font-semibold text-gray-800 mt-1">
                  GSTIN: {shopDetails.gstin}
                </p>
              </div>

              <div className="text-right">
                <h2 className="text-2xl font-bold text-gray-900 tracking-wider">
                  TAX INVOICE
                </h2>

                <p className="text-sm font-semibold text-indigo-600 mt-1">
                  #{invoice.invoice_number}
                </p>

                <div className="mt-2 text-xs space-y-0.5 text-gray-600">
                  <p>
                    <span className="font-semibold text-gray-800">
                      Date:
                    </span>{" "}
                    {formatDate(invoice.issue_date)}
                  </p>

                  <p>
                    <span className="font-semibold text-gray-800">
                      Due Date:
                    </span>{" "}
                    {formatDate(invoice.due_date)}
                  </p>
                </div>
              </div>
            </div>

            {/* Customer & Bill Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">
                <p className="font-bold text-gray-500 uppercase tracking-wider text-[10px] mb-1">
                  Billed To (Customer)
                </p>

                <p className="font-bold text-sm text-gray-900">
                  {invoice.customer?.name || "Walk-in Customer"}
                </p>

                {invoice.customer?.phone && (
                  <p className="text-gray-600">
                    Phone: {invoice.customer.phone}
                  </p>
                )}

                {invoice.customer?.billing_address && (
                  <p className="text-gray-600 mt-0.5">
                    Address: {invoice.customer.billing_address}
                  </p>
                )}

                {invoice.customer?.gstin && (
                  <p className="font-medium text-gray-800 mt-1">
                    GSTIN: {invoice.customer.gstin}
                  </p>
                )}
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs flex flex-col justify-between">
                <div>
                  <p className="font-bold text-gray-500 uppercase tracking-wider text-[10px] mb-1">
                    Invoice Status
                  </p>

                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "badge px-3 py-1 rounded-full text-xs font-bold uppercase",
                        status === "paid" &&
                          "badge-paid bg-emerald-100 text-emerald-800",
                        status === "partially_paid" &&
                          "badge-partial bg-amber-100 text-amber-800",
                        (status === "due" || status === "sent") &&
                          "badge-due bg-red-100 text-red-800"
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </div>

                <div className="mt-2 text-right">
                  <p className="text-[10px] text-gray-500 uppercase font-semibold">
                    Total Amount
                  </p>

                  <p className="text-lg font-black text-indigo-600">
                    {formatCurrency(totalAmt)}
                  </p>
                </div>
              </div>
            </div>

            {/* Product Table */}
            <div className="overflow-hidden border border-gray-200 rounded-lg">
              <table className="items w-full text-xs">
                <thead>
                  <tr className="bg-indigo-600 text-white font-semibold">
                    <th className="py-2 px-3 text-left w-8">#</th>
                    <th className="py-2 px-3 text-left">
                      Item &amp; Description
                    </th>
                    <th className="py-2 px-3 text-center w-20">
                      HSN/SAC
                    </th>
                    <th className="py-2 px-3 text-right w-16">
                      Qty
                    </th>
                    <th className="py-2 px-3 text-right w-24">
                      Rate
                    </th>
                    <th className="py-2 px-3 text-right w-20">
                      GST %
                    </th>
                    <th className="py-2 px-3 text-right w-20">
                      Disc %
                    </th>
                    <th className="py-2 px-3 text-right w-28">
                      Amount
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200">
                  {invoice.items && invoice.items.length > 0 ? (
                    invoice.items.map((item, idx) => (
                      <tr
                        key={item.id || idx}
                        className="hover:bg-gray-50"
                      >
                        <td className="py-2.5 px-3 text-gray-500 text-center">
                          {idx + 1}
                        </td>

                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-gray-900">
                            {item.description}
                          </p>

                          {item.product?.sku && (
                            <p className="text-[10px] text-gray-500">
                              SKU: {item.product.sku}
                            </p>
                          )}
                        </td>

                        <td className="py-2.5 px-3 text-center text-gray-600">
                          {item.product?.hsn_sac || "—"}
                        </td>

                        <td className="py-2.5 px-3 text-right font-medium">
                          {item.quantity}{" "}
                          {item.product?.unit_of_measure || ""}
                        </td>

                        <td className="py-2.5 px-3 text-right text-gray-700">
                          {formatCurrency(Number(item.unit_price))}
                        </td>

                        <td className="py-2.5 px-3 text-right text-gray-700">
                          {item.tax_rate > 0
                            ? `${item.tax_rate}%`
                            : "0%"}
                        </td>

                        <td className="py-2.5 px-3 text-right text-gray-700">
                          {item.discount_percentage > 0
                            ? `${item.discount_percentage}%`
                            : "—"}
                        </td>

                        <td className="py-2.5 px-3 text-right font-bold text-gray-900">
                          {formatCurrency(
                            Number(item.total_amount)
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-4 text-center text-gray-400"
                      >
                        No line items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Totals Summary */}
            <div className="flex justify-end pt-2">
              <table className="totals-table text-xs border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                <tbody>
                  <tr>
                    <td className="text-gray-600 font-medium">
                      Subtotal:
                    </td>

                    <td className="text-right font-semibold">
                      {formatCurrency(
                        Number(invoice.subtotal || 0)
                      )}
                    </td>
                  </tr>

                  <tr>
                    <td className="text-gray-600 font-medium">
                      Total GST:
                    </td>

                    <td className="text-right font-semibold">
                      {formatCurrency(
                        Number(invoice.tax_amount || 0)
                      )}
                    </td>
                  </tr>

                  {Number(invoice.discount_amount || 0) > 0 && (
                    <tr>
                      <td className="text-red-600 font-medium">
                        Discount:
                      </td>

                      <td className="text-right font-semibold text-red-600">
                        -{" "}
                        {formatCurrency(
                          Number(invoice.discount_amount)
                        )}
                      </td>
                    </tr>
                  )}

                  <tr className="border-t border-gray-300 font-bold bg-white text-sm">
                    <td className="text-gray-900 py-2">
                      Grand Total:
                    </td>

                    <td className="text-right text-indigo-600 py-2">
                      {formatCurrency(totalAmt)}
                    </td>
                  </tr>

                  <tr className="text-emerald-700">
                    <td className="font-semibold">
                      Paid Amount:
                    </td>

                    <td className="text-right font-bold">
                      {formatCurrency(paidAmt)}
                    </td>
                  </tr>

                  <tr className="text-amber-800 bg-amber-50 font-bold border-t border-amber-200">
                    <td className="py-1.5">
                      Balance Amount:
                    </td>

                    <td className="text-right py-1.5">
                      {formatCurrency(balanceAmt)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {invoice.notes && (
              <div className="border-t border-gray-200 pt-3 text-xs">
                <p className="font-bold text-gray-500 uppercase text-[10px]">
                  Notes / Instructions
                </p>

                <p className="text-gray-700 mt-0.5">
                  {invoice.notes}
                </p>
              </div>
            )}

            {/* Footer Signatory & Terms */}
            <div className="pt-6 border-t border-gray-200 flex justify-between items-end text-[10px] text-gray-500">
              <div>
                <p className="font-bold text-gray-700 mb-1">
                  Terms &amp; Conditions:
                </p>

                <p className="whitespace-pre-line">
                  {shopDetails.terms ||
                    DEFAULT_SHOP_DETAILS.terms}
                </p>

                <p className="mt-2 text-indigo-600 font-semibold">
                  {shopDetails.footer ||
                    DEFAULT_SHOP_DETAILS.footer}
                </p>
              </div>

              <div className="text-center w-48">
                <div className="h-12 border-b border-gray-400 mb-1"></div>

                <p className="font-bold text-gray-800">
                  For {shopDetails.name}
                </p>

                <p className="text-[9px] text-gray-400">
                  (Authorised Signatory)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}