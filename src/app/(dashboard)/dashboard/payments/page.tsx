"use client";

import { useState, useEffect } from "react";
import { db } from '@/lib/db';
import type { Payment, Invoice, Customer } from "@/types/database";
import {
  CreditCard,
  Plus,
  Loader2,
  AlertCircle,
  Search,
  CheckCircle,
  X,
  IndianRupee,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

export default function PaymentsPage() {
  
  const [payments, setPayments] = useState<(Payment & { invoice?: Invoice & { customer?: Customer } })[]>([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState<(Invoice & { customer?: Customer })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<(Invoice & { customer?: Customer }) | null>(null);
  const [paidAmountInput, setPaidAmountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "upi">("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    // Fetch payments list
    const { data: pymts, error: pErr } = await db
      .from("payments")
      .select("*, invoice:invoices(*, customer:customers(*))")
      .order("created_at", { ascending: false })
      .limit(500);

    // Fetch invoices with balance > 0 for recording new payments
    const { data: invs, error: iErr } = await db
      .from("invoices")
      .select("*, customer:customers(*)")
      .gt("amount_due", 0)
      .order("created_at", { ascending: false })
      .limit(200);

    if (pErr) {
      setError(pErr.message);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedPymts = (pymts as any[])?.map((p) => ({
        ...p,
        invoice: Array.isArray(p.invoice)
          ? {
              ...p.invoice[0],
              customer: Array.isArray(p.invoice[0]?.customer)
                ? p.invoice[0]?.customer[0]
                : p.invoice[0]?.customer,
            }
          : p.invoice
          ? {
              ...p.invoice,
              customer: Array.isArray(p.invoice.customer)
                ? p.invoice.customer[0]
                : p.invoice.customer,
            }
          : undefined,
      })) || [];
      setPayments(mappedPymts);
    }

    if (iErr) {
      console.error(iErr);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedInvs = (invs as any[])?.map((inv) => ({
        ...inv,
        customer: Array.isArray(inv.customer) ? inv.customer[0] : inv.customer,
      })) || [];
      setUnpaidInvoices(mappedInvs);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenModal = (invoice?: Invoice & { customer?: Customer }) => {
    setSelectedInvoice(invoice || null);
    setPaidAmountInput(invoice ? invoice.amount_due.toString() : "");
    setPaymentMethod("cash");
    setPaymentNotes("");
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleInvoiceSelect = (invId: string) => {
    const inv = unpaidInvoices.find((i) => i.id === invId) || null;
    setSelectedInvoice(inv);
    if (inv) {
      setPaidAmountInput(inv.amount_due.toString());
    } else {
      setPaidAmountInput("");
    }
  };

  // Stage 6 Calculations
  const currentTotal = selectedInvoice ? Number(selectedInvoice.total_amount) : 0;
  const currentPaid = selectedInvoice ? Number(selectedInvoice.amount_paid) : 0;
  const currentBalance = selectedInvoice ? Number(selectedInvoice.amount_due) : 0;

  const enteredPaidAmount = parseFloat(paidAmountInput) || 0;
  const isPaidExceedingBalance = enteredPaidAmount > currentBalance;
  const newTotalPaid = currentPaid + enteredPaidAmount;
  const newBalanceAmount = Math.max(0, currentTotal - newTotalPaid);

  // Auto Status computation according to Stage 6 rules:
  // Paid Amount = Total → PAID
  // Paid Amount > 0 but Balance > 0 → PARTIALLY PAID
  // Paid Amount = 0 → DUE
  let computedNewStatus: "paid" | "partially_paid" | "due" = "due";
  if (newBalanceAmount === 0 && currentTotal > 0) {
    computedNewStatus = "paid";
  } else if (newTotalPaid > 0 && newBalanceAmount > 0) {
    computedNewStatus = "partially_paid";
  } else {
    computedNewStatus = "due";
  }

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) {
      setModalError("Please select an invoice.");
      return;
    }
    if (enteredPaidAmount <= 0) {
      setModalError("Please enter a valid paid amount greater than 0.");
      return;
    }
    if (isPaidExceedingBalance) {
      setModalError(`Paid Amount cannot exceed Current Balance (${formatCurrency(currentBalance)}).`);
      return;
    }

    setIsSaving(true);
    setModalError(null);

    try {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 1. Insert into payments table
      const { error: pErr } = await (db.from("payments") as any).insert([
        {
          invoice_id: selectedInvoice.id,
          payment_date: new Date().toISOString().split("T")[0],
          amount: enteredPaidAmount,
          payment_method: paymentMethod,
          status: "completed",
          notes: paymentNotes || null,
          created_by: user.id,
        },
      ]);

      if (pErr) throw new Error(pErr.message);

      // 2. Update invoice amount_paid, amount_due, and status
      const { error: iErr } = await (db.from("invoices") as any)
        .update({
          amount_paid: newTotalPaid,
          status: computedNewStatus,
        })
        .eq("id", selectedInvoice.id);

      if (iErr) throw new Error(iErr.message);

      setIsModalOpen(false);
      await fetchData();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Payments</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Record manual payments and track invoice balances
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Record Payment
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      ) : payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <CreditCard className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">No payments recorded</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Record payments against invoices to update balances.
          </p>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Record Payment
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Invoice #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount Paid</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Notes</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(p.payment_date)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600 dark:text-indigo-400">
                    {p.invoice?.invoice_number || "—"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {p.invoice?.customer?.name || "—"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(Number(p.amount))}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                    {p.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stage 6 Record Payment Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Record Payment</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {modalError}
              </div>
            )}

            <form onSubmit={handleRecordPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Select Invoice *
                </label>
                <select
                  required
                  value={selectedInvoice?.id || ""}
                  onChange={(e) => handleInvoiceSelect(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Choose Invoice with Balance --</option>
                  {unpaidInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} - {inv.customer?.name || "Customer"} (Balance: {formatCurrency(inv.amount_due)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedInvoice && (
                <div className="space-y-3 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Total Amount</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(currentTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Already Paid</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(currentPaid)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-1 font-medium">
                    <span className="text-amber-900 dark:text-amber-400">Current Balance</span>
                    <span className="font-bold text-amber-900 dark:text-amber-400">{formatCurrency(currentBalance)}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Paid Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={currentBalance || undefined}
                  required
                  value={paidAmountInput}
                  onChange={(e) => setPaidAmountInput(e.target.value)}
                  className={cn(
                    "w-full px-3 py-2 text-base font-semibold text-right border rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2",
                    isPaidExceedingBalance
                      ? "border-red-500 focus:ring-red-500 text-red-600"
                      : "border-gray-300 dark:border-gray-600 focus:ring-indigo-500 text-emerald-600 dark:text-emerald-400"
                  )}
                  placeholder="0.00"
                />
                {isPaidExceedingBalance && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">
                    Paid Amount cannot exceed Current Balance ({formatCurrency(currentBalance)})
                  </p>
                )}
              </div>

              {selectedInvoice && (
                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg space-y-1 text-xs">
                  <div className="flex justify-between text-indigo-900 dark:text-indigo-300">
                    <span>New Balance After Payment</span>
                    <span className="font-bold">{formatCurrency(newBalanceAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center text-indigo-900 dark:text-indigo-300 pt-1">
                    <span>Resulting Status</span>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                        computedNewStatus === "paid" && "bg-emerald-100 text-emerald-800",
                        computedNewStatus === "partially_paid" && "bg-amber-100 text-amber-800"
                      )}
                    >
                      {computedNewStatus === "paid" ? "PAID" : "PARTIALLY PAID"}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Payment Method *
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="pay_method"
                      value="cash"
                      checked={paymentMethod === "cash"}
                      onChange={(e) => setPaymentMethod(e.target.value as "cash" | "upi")}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    Cash
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="pay_method"
                      value="upi"
                      checked={paymentMethod === "upi"}
                      onChange={(e) => setPaymentMethod(e.target.value as "cash" | "upi")}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    UPI
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Notes / Reference (Optional)
                </label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Optional reference notes"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !selectedInvoice || isPaidExceedingBalance || enteredPaidAmount <= 0}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Save Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
