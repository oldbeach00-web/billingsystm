"use client";

import { useState, useEffect } from "react";
import { db } from '@/lib/db';
import type { Invoice, Customer } from "@/types/database";
import {
  CreditCard,
  Search,
  Loader2,
  AlertCircle,
  X,
  CheckCircle,
  Plus,
  Filter,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

type DueInvoice = Invoice & { customer?: Customer };

export default function DueManagementPage() {
  
  const [invoices, setInvoices] = useState<DueInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");

  // Payment Modal State
  const [selectedInvoice, setSelectedInvoice] = useState<DueInvoice | null>(null);
  const [newPaymentInput, setNewPaymentInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "upi">("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchDueInvoices = async () => {
    setIsLoading(true);
    setError(null);

    // Fetch invoices with balance > 0 and customers
    const [{ data: invData, error: invErr }, { data: custData }] = await Promise.all([
      db
        .from("invoices")
        .select("*, customer:customers(*)")
        .gt("amount_due", 0)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("customers").select("*").order("name"),
    ]);

    if (invErr) {
      setError(invErr.message);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = (invData as any[])?.map((inv) => ({
        ...inv,
        customer: Array.isArray(inv.customer) ? inv.customer[0] : inv.customer,
      })) || [];
      setInvoices(mapped);
    }

    if (custData) setCustomers(custData);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchDueInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenPaymentModal = (inv: DueInvoice) => {
    setSelectedInvoice(inv);
    setNewPaymentInput(inv.amount_due ? inv.amount_due.toString() : "");
    setPaymentMethod("cash");
    setPaymentNotes("");
    setModalError(null);
  };

  // Stage 9 Payment Logic & Formula:
  // Old Balance (e.g. ₹2,000)
  // New Payment (e.g. ₹1,000)
  // Remaining Balance (Formula: Old Balance - New Payment = ₹1,000)
  // When balance becomes ₹0 → Status automatically becomes PAID
  const oldBalance = selectedInvoice ? Number(selectedInvoice.amount_due ?? 0) : 0;
  const currentTotal = selectedInvoice ? Number(selectedInvoice.total_amount || 0) : 0;
  const currentPaid = selectedInvoice ? Number(selectedInvoice.amount_paid || 0) : 0;

  const newPayment = parseFloat(newPaymentInput) || 0;
  const isExceedingBalance = newPayment > oldBalance;
  const remainingBalance = isExceedingBalance ? 0 : Math.max(0, oldBalance - newPayment);
  const updatedTotalPaid = currentPaid + newPayment;

  let computedStatus: "paid" | "partially_paid" | "due" = "due";
  if (remainingBalance === 0 && currentTotal > 0) {
    computedStatus = "paid";
  } else if (updatedTotalPaid > 0 && remainingBalance > 0) {
    computedStatus = "partially_paid";
  } else {
    computedStatus = "due";
  }

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    if (newPayment <= 0) {
      setModalError("Please enter a valid payment amount greater than 0.");
      return;
    }

    if (isExceedingBalance) {
      setModalError(`New Payment cannot exceed Old Balance (${formatCurrency(oldBalance)}).`);
      return;
    }

    setIsSaving(true);
    setModalError(null);
    setSuccessMessage(null);

    try {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Authentication error. Please log in again.");

      // 1. Insert payment history
      const { error: pErr } = await (db.from("payments") as any).insert([
        {
          invoice_id: selectedInvoice.id,
          payment_date: new Date().toISOString().split("T")[0],
          amount: newPayment,
          payment_method: paymentMethod,
          status: "completed",
          notes: paymentNotes || `Due payment for Invoice #${selectedInvoice.invoice_number}`,
          created_by: user.id,
        },
      ]);

      if (pErr) throw new Error("Error saving payment: " + pErr.message);

      // 2. Update Invoice record (amount_paid, amount_due, status)
      const { error: iErr } = await (db.from("invoices") as any)
        .update({
          amount_paid: updatedTotalPaid,
          amount_due: remainingBalance,
          status: computedStatus,
        })
        .eq("id", selectedInvoice.id);

      if (iErr) throw new Error("Error updating invoice balance: " + iErr.message);

      setSuccessMessage(`Payment of ${formatCurrency(newPayment)} recorded for Invoice #${selectedInvoice.invoice_number}!`);
      setTimeout(() => {
        setSelectedInvoice(null);
        setSuccessMessage(null);
        fetchDueInvoices();
      }, 1200);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSaving(false);
    }
  };

  // Filtered due invoices
  const filtered = invoices.filter((inv) => {
    const matchesSearch =
      inv.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
      (inv.customer?.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (inv.customer?.phone || "").includes(search);

    const matchesCustomer =
      customerFilter === "all" ? true : inv.customer_id === customerFilter;

    return matchesSearch && matchesCustomer;
  });

  // Calculate summary metrics for due page
  const totalDueSum = invoices.reduce((sum, inv) => sum + Number(inv.amount_due || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Balance Amount</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track outstanding invoice balances and record customer payments
          </p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-4 py-2 rounded-xl flex items-center gap-3">
          <CreditCard className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-400">Total System Outstanding</p>
            <p className="text-lg font-black text-amber-900 dark:text-amber-300">{formatCurrency(totalDueSum)}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by Invoice #, Customer Name, or Phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="sm:w-64">
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Due Invoices Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <CheckCircle className="w-12 h-12 text-emerald-400 mb-4" />
          <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">No pending dues!</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            All customer invoices have been fully paid.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Invoice #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Invoice Date</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Paid</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Balance Amount</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filtered.map((inv) => {
                const status = inv.status || "due";
                const totalAmt = Number(inv.total_amount || 0);
                const paidAmt = Number(inv.amount_paid || 0);
                const balanceAmt = Number(inv.amount_due ?? Math.max(0, totalAmt - paidAmt));

                return (
                  <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">
                      {inv.customer?.name || "Walk-in Customer"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600 dark:text-indigo-400">
                      {inv.invoice_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(inv.issue_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-gray-900 dark:text-white">
                      {formatCurrency(totalAmt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(paidAmt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-amber-600 dark:text-amber-400">
                      {formatCurrency(balanceAmt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span
                        className={cn(
                          "inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider",
                          status === "partially_paid" && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                          (status === "due" || status === "sent") && "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                        )}
                      >
                        {status === "partially_paid" ? "PARTIALLY PAID" : "DUE"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleOpenPaymentModal(inv)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition-colors text-xs font-semibold shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Pay Balance
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No pending dues match your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Stage 9 Record Payment Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Record Due Payment</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Invoice #{selectedInvoice.invoice_number} • {selectedInvoice.customer?.name}
                </p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {modalError}
              </div>
            )}

            {successMessage && (
              <div className="mb-4 p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-sm flex items-center gap-2 font-medium">
                <CheckCircle className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                {successMessage}
              </div>
            )}

            <form onSubmit={handleRecordPayment} className="space-y-4">
              {/* Stage 9 Balance Breakdown Box */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 p-4 rounded-xl space-y-2">
                <div className="flex justify-between items-center text-sm text-amber-900 dark:text-amber-300 font-medium">
                  <span>Old Balance:</span>
                  <span className="text-base font-bold">{formatCurrency(oldBalance)}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                  <span>New Payment:</span>
                  <span className="font-bold">{formatCurrency(newPayment)}</span>
                </div>
                <div className="border-t border-amber-200 dark:border-amber-800/50 pt-2 flex justify-between items-center text-sm font-bold text-amber-950 dark:text-amber-200">
                  <span>Remaining Balance:</span>
                  <span className="text-lg font-black">{formatCurrency(remainingBalance)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New Payment (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={oldBalance}
                  required
                  value={newPaymentInput}
                  onChange={(e) => setNewPaymentInput(e.target.value)}
                  className={cn(
                    "w-full px-3 py-2 text-base font-semibold text-right border rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2",
                    isExceedingBalance
                      ? "border-red-500 focus:ring-red-500 text-red-600"
                      : "border-gray-300 dark:border-gray-600 focus:ring-indigo-500 text-emerald-600 dark:text-emerald-400"
                  )}
                  placeholder="0.00"
                />
                {isExceedingBalance && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">
                    New Payment cannot exceed Old Balance ({formatCurrency(oldBalance)})
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Payment Method *
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="payment_method"
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
                      name="payment_method"
                      value="upi"
                      checked={paymentMethod === "upi"}
                      onChange={(e) => setPaymentMethod(e.target.value as "cash" | "upi")}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    UPI
                  </label>
                </div>
              </div>

              {/* Status Preview */}
              <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg flex items-center justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-400 font-medium">Updated Status After Payment:</span>
                <span
                  className={cn(
                    "px-2.5 py-0.5 rounded-full font-bold text-xs uppercase",
                    computedStatus === "paid" && "bg-emerald-100 text-emerald-800",
                    computedStatus === "partially_paid" && "bg-amber-100 text-amber-800"
                  )}
                >
                  {computedStatus === "paid" ? "PAID (Balance ₹0)" : "PARTIALLY PAID"}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Payment Notes (Optional)
                </label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Optional reference / note"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || isExceedingBalance || newPayment <= 0}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Confirm Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
