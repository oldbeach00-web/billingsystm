"use client";

import { useRef } from "react";
import { X, Printer, CheckCircle, Loader2 } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { BillCustomer, BillLineItem } from "@/app/(dashboard)/dashboard/invoices/new/page";

interface BillPreviewProps {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  customer: BillCustomer;
  lines: BillLineItem[];
  subtotal: number;
  globalDiscountAmt: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: "paid" | "partially_paid" | "due";
  notes: string;
  onClose: () => void;
  onConfirm: () => void;
  isSaving: boolean;
}

export function BillPreview({
  invoiceNumber,
  issueDate,
  dueDate,
  customer,
  lines,
  subtotal,
  globalDiscountAmt,
  grandTotal,
  paidAmount,
  balanceAmount,
  paymentStatus,
  notes,
  onClose,
  onConfirm,
  isSaving,
}: BillPreviewProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!printRef.current) return;
    const printContents = printRef.current.innerHTML;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Invoice ${invoiceNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 32px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 8px 10px; }
            thead th { background: #f3f4f6; border-bottom: 2px solid #e5e7eb; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
            tbody tr { border-bottom: 1px solid #f3f4f6; }
            .text-right { text-align: right; }
            .totals td { padding: 4px 10px; }
            .grand-total { font-size: 16px; font-weight: bold; color: #4f46e5; }
            h1 { font-size: 22px; font-weight: bold; }
            .label { color: #6b7280; font-size: 11px; }
            .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
            .badge-paid { background: #d1fae5; color: #065f46; }
            .badge-partial { background: #fef3c7; color: #92400e; }
            .badge-due { background: #fee2e2; color: #991b1b; }
          </style>
        </head>
        <body>${printContents}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  };

  const statusLabel =
    paymentStatus === "paid"
      ? "PAID"
      : paymentStatus === "partially_paid"
      ? "PARTIALLY PAID"
      : "DUE";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Bill Preview</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Review payment details before confirming invoice.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable invoice content */}
        <div className="overflow-y-auto flex-1 p-6">
          <div ref={printRef} className="space-y-6">
            {/* Invoice header */}
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-gray-900">INVOICE</h1>
                  <span
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                      paymentStatus === "paid" && "bg-emerald-100 text-emerald-800",
                      paymentStatus === "partially_paid" && "bg-amber-100 text-amber-800",
                      paymentStatus === "due" && "bg-red-100 text-red-800"
                    )}
                  >
                    {statusLabel}
                  </span>
                </div>
                <p className="text-gray-500 text-sm mt-1">#{invoiceNumber}</p>
              </div>
              <div className="text-right text-sm">
                <p className="text-gray-500 label">Issue Date</p>
                <p className="font-medium text-gray-900">{formatDate(issueDate)}</p>
                <p className="text-gray-500 label mt-1">Due Date</p>
                <p className="font-medium text-gray-900">{formatDate(dueDate)}</p>
              </div>
            </div>

            {/* Customer info */}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Bill To</p>
              <p className="font-semibold text-gray-900 dark:text-white">{customer.name}</p>
              {customer.phone && <p className="text-gray-600 dark:text-gray-400">{customer.phone}</p>}
              {customer.billing_address && <p className="text-gray-600 dark:text-gray-400">{customer.billing_address}</p>}
            </div>

            {/* Line items */}
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="px-3 py-3 text-left">#</th>
                    <th className="px-3 py-3 text-left">Description</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3 text-right">Unit Price</th>
                    <th className="px-3 py-3 text-right">Disc</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {lines.map((line, i) => (
                    <tr key={line.id}>
                      <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">{i + 1}</td>
                      <td className="px-3 py-3">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{line.description}</p>
                        {line.product?.sku && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            SKU: {line.product.sku}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        {line.quantity} {line.product?.unit_of_measure || ""}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        {formatCurrency(line.unit_price)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                        {line.discount_percentage > 0 ? `${line.discount_percentage}%` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(line.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals & Payment Breakdown */}
            <div className="flex justify-end">
              <div className="w-80 space-y-2 text-sm border-t border-gray-200 dark:border-gray-700 pt-3">
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {globalDiscountAmt > 0 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400">
                    <span>Discount</span>
                    <span>- {formatCurrency(globalDiscountAmt)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700 font-bold">
                  <span className="text-gray-900 dark:text-white">Total Amount</span>
                  <span className="text-lg text-indigo-600 dark:text-indigo-400">
                    {formatCurrency(grandTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-emerald-700 dark:text-emerald-400 pt-1">
                  <span>Paid Amount</span>
                  <span className="font-semibold">{formatCurrency(paidAmount)}</span>
                </div>
                <div className="flex justify-between items-center text-amber-700 dark:text-amber-400 pt-1 border-t border-gray-100 dark:border-gray-800">
                  <span className="font-semibold">Balance Amount</span>
                  <span className="font-bold text-base">{formatCurrency(balanceAmount)}</span>
                </div>
              </div>
            </div>

            {notes && (
              <div className="text-sm pt-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Notes</p>
                <p className="text-gray-700 dark:text-gray-300">{notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print Preview
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Back to Edit
            </button>
            <button
              onClick={onConfirm}
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Confirm &amp; Save Invoice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
