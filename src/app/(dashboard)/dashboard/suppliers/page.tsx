"use client";

import { useState } from "react";
import { Plus, Pencil, Archive, FilePlus2, Wallet, Ban, Loader2, Trash2 } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { localDateString, round2 } from "@/lib/billing";
import { db } from "@/lib/db";
import {
  accountsFor,
  check,
  initialAccountId,
  fdb,
  loadAll,
  type FinanceAccount,
  type PaymentMode,
  type Supplier,
  type SupplierBalance,
  type SupplierBill,
  type SupplierPayment,
} from "@/lib/finance";
import {
  AccountSelect,
  accountProblem,
  ErrorBanner,
  Field,
  Loading,
  ModeBadge,
  ModeSelect,
  Modal,
  PageHeader,
  StatCard,
  cardClass,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/finance/ui";
import { useLoad } from "@/components/finance/useLoad";

const loadPage = async () => {
  const [suppliers, balances, bills, payments, accounts] = await Promise.all([
    loadAll<Supplier>("suppliers", "name"),
    loadAll<SupplierBalance>("supplier_balances", "name"),
    loadAll<SupplierBill>("supplier_bills", "bill_date", false),
    loadAll<SupplierPayment>("supplier_payments", "payment_date", false),
    loadAll<FinanceAccount>("finance_accounts", "name"),
  ]);
  return { suppliers, balances, bills, payments, accounts };
};

const STATUS_STYLE: Record<SupplierBill["status"], string> = {
  unpaid: "bg-red-100 text-red-800",
  partially_paid: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-200 text-gray-500 line-through",
};

const STATUS_LABEL: Record<SupplierBill["status"], string> = {
  unpaid: "Unpaid",
  partially_paid: "Partly paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Supplier ledger: opening balance, bills increase what you owe, payments reduce it. */
function buildSupplierLedger(
  suppliers: Supplier[],
  bills: SupplierBill[],
  payments: SupplierPayment[],
  selected: string
) {
  const supplier = suppliers.find((s) => s.id === selected);
  if (!supplier) return { rows: [], opening: 0, closing: 0 };
  const rows = [
    ...bills
      .filter((b) => b.supplier_id === selected && b.status !== "cancelled")
      .map((b) => ({
        key: `b-${b.id}`, date: b.bill_date, type: "Bill",
        details: `Bill ${b.bill_number || ""}${b.notes ? ` · ${b.notes}` : ""}`,
        billed: b.amount, paid: 0, mode: "", paymentId: "",
      })),
    ...payments
      .filter((p) => p.supplier_id === selected)
      .map((p) => {
        const bill = bills.find((b) => b.id === p.supplier_bill_id);
        return {
          key: `p-${p.id}`, date: p.payment_date, type: "Payment",
          details: `${bill ? `Against bill ${bill.bill_number || ""}` : "On account"}${p.reference ? ` · ${p.reference}` : ""}${p.notes ? ` · ${p.notes}` : ""}`,
          billed: 0, paid: p.amount, mode: p.payment_mode, paymentId: p.id,
        };
      }),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === "Bill" ? -1 : 1));
  let running = supplier.opening_balance;
  const withBalance = rows.map((r) => {
    running = round2(running + r.billed - r.paid);
    return { ...r, balance: running };
  });
  return { rows: withBalance, opening: supplier.opening_balance, closing: round2(running) };
}

export default function SuppliersPage() {
  const { data, error, setError, isLoading, reload } = useLoad(loadPage, {
    suppliers: [] as Supplier[],
    balances: [] as SupplierBalance[],
    bills: [] as SupplierBill[],
    payments: [] as SupplierPayment[],
    accounts: [] as FinanceAccount[],
  });
  const { suppliers, balances, bills, payments, accounts } = data;

  const [selectedId, setSelectedId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");

  const [supplierForm, setSupplierForm] = useState<{
    id: string | null; name: string; phone: string; email: string; gstin: string;
    address: string; opening_balance: string; notes: string;
  } | null>(null);
  const [billForm, setBillForm] = useState<{
    supplier_id: string; bill_number: string; bill_date: string; due_date: string; amount: string; notes: string;
  } | null>(null);
  const [payForm, setPayForm] = useState<{
    supplier_id: string; bill_id: string; amount: string; payment_date: string;
    payment_mode: PaymentMode; account_id: string; reference: string; notes: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const outstandingOf = (id: string) => balances.find((b) => b.id === id)?.outstanding ?? 0;
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "—";

  const list = suppliers.filter(
    (s) =>
      (showArchived || s.is_active) &&
      (!search.trim() || s.name.toLowerCase().includes(search.trim().toLowerCase()) || (s.phone ?? "").includes(search.trim()))
  );
  const selected = selectedId || list[0]?.id || "";
  const today = localDateString();

  const totals = {
    payable: round2(balances.reduce((s, b) => s + Math.max(0, b.outstanding), 0)),
    overdue: round2(
      bills
        .filter((b) => b.status !== "cancelled" && b.status !== "paid" && b.due_date && b.due_date < today)
        .reduce((s, b) => s + b.amount_due, 0)
    ),
    paidThisMonth: round2(
      payments.filter((p) => p.payment_date.slice(0, 7) === today.slice(0, 7)).reduce((s, p) => s + p.amount, 0)
    ),
  };

  const ledger = buildSupplierLedger(suppliers, bills, payments, selected);

  const run = async (action: () => Promise<void>, close: () => void) => {
    setIsSaving(true);
    setFormError(null);
    try {
      await action();
      close();
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setIsSaving(false);
    }
  };

  const saveSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm) return;
    if (!supplierForm.name.trim()) return setFormError("Enter the supplier's name.");
    const opening = round2(parseFloat(supplierForm.opening_balance) || 0);
    const payload = {
      name: supplierForm.name.trim(),
      phone: supplierForm.phone.trim() || null,
      email: supplierForm.email.trim() || null,
      gstin: supplierForm.gstin.trim().toUpperCase() || null,
      address: supplierForm.address.trim() || null,
      opening_balance: opening,
      notes: supplierForm.notes.trim() || null,
    };
    void run(async () => {
      const { error: err } = supplierForm.id
        ? await fdb("suppliers").update(payload).eq("id", supplierForm.id)
        : await fdb("suppliers").insert([payload]);
      check(err, "Could not save the supplier");
    }, () => setSupplierForm(null));
  };

  const archive = async (s: Supplier) => {
    if (!window.confirm(`${s.is_active ? "Archive" : "Restore"} ${s.name}? Bills and payments are kept.`)) return;
    const { error: err } = await fdb("suppliers").update({ is_active: !s.is_active }).eq("id", s.id);
    if (err) setError(err.message);
    else await reload();
  };

  const saveBill = (e: React.FormEvent) => {
    e.preventDefault();
    if (!billForm) return;
    const amount = round2(parseFloat(billForm.amount));
    if (!billForm.supplier_id) return setFormError("Choose a supplier.");
    if (!(amount > 0)) return setFormError("Enter a bill amount greater than 0.");
    if (billForm.due_date && billForm.due_date < billForm.bill_date) return setFormError("Due date cannot be before the bill date.");
    void run(async () => {
      const { error: err } = await fdb("supplier_bills").insert([
        {
          supplier_id: billForm.supplier_id,
          bill_number: billForm.bill_number.trim() || null,
          bill_date: billForm.bill_date,
          due_date: billForm.due_date || null,
          amount,
          notes: billForm.notes.trim() || null,
        },
      ]);
      check(err, "Could not save the bill");
    }, () => setBillForm(null));
  };

  const cancelBill = async (b: SupplierBill) => {
    if (!window.confirm(`Cancel bill ${b.bill_number || ""} of ${formatCurrency(b.amount)}?`)) return;
    const { error: err } = await db.rpc("cancel_supplier_bill", { p_bill_id: b.id });
    if (err) setError((err as { message?: string }).message || "Could not cancel the bill.");
    else await reload();
  };

  const openPay = (supplierId: string, bill?: SupplierBill) => {
    setFormError(null);
    setPayForm({
      supplier_id: supplierId,
      bill_id: bill?.id ?? "",
      amount: bill ? String(bill.amount_due) : "",
      payment_date: localDateString(),
      payment_mode: "cash",
      account_id: initialAccountId(accounts, "cash"),
      reference: "",
      notes: "",
    });
  };

  const savePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payForm) return;
    const amount = round2(parseFloat(payForm.amount));
    if (!payForm.supplier_id) return setFormError("Choose a supplier.");
    if (!(amount > 0)) return setFormError("Enter an amount greater than 0.");
    const problem = accountProblem(accounts, payForm.payment_mode, payForm.account_id);
    if (problem) return setFormError(problem);
    void run(async () => {
      // pay_supplier locks the bill and re-checks its balance on the server
      const { error: err } = await db.rpc("pay_supplier", {
        p_supplier_id: payForm.supplier_id,
        p_bill_id: payForm.bill_id || null,
        p_amount: amount,
        p_payment_mode: payForm.payment_mode,
        p_account_id: payForm.account_id,
        p_payment_date: payForm.payment_date,
        p_reference: payForm.reference,
        p_notes: payForm.notes,
      });
      check(err as { message?: string; code?: string } | null, "Could not record the payment");
    }, () => setPayForm(null));
  };

  const deletePayment = async (paymentId: string, amount: number) => {
    if (!window.confirm(`Delete this ${formatCurrency(amount)} payment? The bill it paid becomes due again.`)) return;
    const { error: err } = await db.rpc("delete_supplier_payment", { p_payment_id: paymentId });
    if (err) setError((err as { message?: string }).message || "Could not delete the payment.");
    else await reload();
  };

  const selectedBills = bills.filter((b) => b.supplier_id === selected);
  const openBillsFor = (supplierId: string) =>
    bills.filter((b) => b.supplier_id === supplierId && (b.status === "unpaid" || b.status === "partially_paid"));

  return (
    <div className="space-y-6">
      <PageHeader title="Suppliers & Payables" subtitle="Supplier ledger, purchase bills and payments by Cash, UPI or Bank">
        <button
          onClick={() => { setFormError(null); setBillForm({ supplier_id: selected, bill_number: "", bill_date: localDateString(), due_date: "", amount: "", notes: "" }); }}
          className={secondaryButton}
          disabled={suppliers.length === 0}
        >
          <FilePlus2 className="w-4 h-4" /> Add Bill
        </button>
        <button onClick={() => openPay(selected)} className={secondaryButton} disabled={suppliers.length === 0}>
          <Wallet className="w-4 h-4" /> Pay Supplier
        </button>
        <button
          onClick={() => { setFormError(null); setSupplierForm({ id: null, name: "", phone: "", email: "", gstin: "", address: "", opening_balance: "", notes: "" }); }}
          className={primaryButton}
        >
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </PageHeader>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total payable" value={totals.payable} tone={totals.payable > 0 ? "bad" : "good"} />
        <StatCard label="Overdue bills" value={totals.overdue} tone={totals.overdue > 0 ? "bad" : "good"} />
        <StatCard label="Paid this month" value={totals.paidThisMonth} />
      </div>

      {isLoading ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          <div className={cn(cardClass, "xl:col-span-2 overflow-x-auto")}>
            <div className="p-4 flex flex-wrap items-center gap-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className={cn(inputClass, "flex-1 min-w-40")} />
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
              </label>
            </div>
            <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left">Supplier</th>
                  <th className="px-4 py-2 text-right">Payable</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                {list.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">No suppliers yet.</td></tr>
                )}
                {list.map((s) => (
                  <tr key={s.id} onClick={() => setSelectedId(s.id)} className={cn("cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50", s.id === selected && "bg-indigo-50/50 dark:bg-indigo-900/10", !s.is_active && "opacity-50")}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-gray-900 dark:text-white">{s.name}</p>
                      <p className="text-xs text-gray-500">{s.phone || ""}</p>
                    </td>
                    <td className={cn("px-4 py-2 text-right font-semibold", outstandingOf(s.id) > 0 ? "text-red-600" : "text-gray-400")}>{formatCurrency(outstandingOf(s.id))}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setFormError(null); setSupplierForm({ id: s.id, name: s.name, phone: s.phone ?? "", email: s.email ?? "", gstin: s.gstin ?? "", address: s.address ?? "", opening_balance: String(s.opening_balance), notes: s.notes ?? "" }); }}
                        className="text-indigo-600 hover:text-indigo-900 mr-3" title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => archive(s)} className="text-gray-500 hover:text-gray-800" title={s.is_active ? "Archive" : "Restore"}><Archive className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!selected ? (
            <div className={cn(cardClass, "xl:col-span-3 p-8 text-center text-sm text-gray-500")}>
              Add a supplier to record purchase bills, payments and see their ledger.
            </div>
          ) : (
          <div className="xl:col-span-3 space-y-6">
            <div className={cn(cardClass, "overflow-x-auto")}>
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">Ledger · {supplierName(selected)}</h3>
                <span className={cn("text-sm font-bold", ledger.closing > 0 ? "text-red-600" : "text-emerald-600")}>
                  {ledger.closing >= 0 ? "You owe " : "Advance paid "}{formatCurrency(Math.abs(ledger.closing))}
                </span>
              </div>
              <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Details</th>
                    <th className="px-4 py-2 text-right">Bill</th>
                    <th className="px-4 py-2 text-right">Paid</th>
                    <th className="px-4 py-2 text-right">Balance</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                  <tr className="bg-gray-50/50 dark:bg-gray-900/20">
                    <td className="px-4 py-2" colSpan={4}>Opening balance{ledger.opening < 0 ? " (advance paid)" : ""}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatCurrency(ledger.opening)}</td>
                    <td />
                  </tr>
                  {ledger.rows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-4 py-2">{r.details} {r.mode && <ModeBadge mode={r.mode} />}</td>
                      <td className="px-4 py-2 text-right">{r.billed ? formatCurrency(r.billed) : ""}</td>
                      <td className="px-4 py-2 text-right text-emerald-600">{r.paid ? formatCurrency(r.paid) : ""}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatCurrency(r.balance)}</td>
                      <td className="px-4 py-2 text-right">
                        {r.paymentId && (
                          <button onClick={() => deletePayment(r.paymentId, r.paid)} className="text-red-600 hover:text-red-900" title="Delete payment (correct a mistake)">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={cn(cardClass, "overflow-x-auto")}>
              <div className="px-4 pt-4 pb-2 font-semibold text-gray-900 dark:text-white">Bills · {supplierName(selected)}</div>
              <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Bill</th>
                    <th className="px-4 py-2 text-left">Date / Due</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Due</th>
                    <th className="px-4 py-2 text-center">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                  {selectedBills.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No bills for this supplier.</td></tr>
                  )}
                  {selectedBills.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2 font-medium">{b.bill_number || "—"}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {formatDate(b.bill_date)}
                        {b.due_date && (
                          <span className={cn("block text-xs", b.status !== "paid" && b.status !== "cancelled" && b.due_date < today ? "text-red-600 font-semibold" : "text-gray-500")}>
                            due {formatDate(b.due_date)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{formatCurrency(b.amount)}</td>
                      <td className="px-4 py-2 text-right font-semibold">{b.status === "cancelled" ? "—" : formatCurrency(b.amount_due)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-semibold", STATUS_STYLE[b.status])}>{STATUS_LABEL[b.status]}</span>
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {(b.status === "unpaid" || b.status === "partially_paid") && (
                          <button onClick={() => openPay(b.supplier_id, b)} className="text-emerald-600 hover:text-emerald-800 mr-3" title="Pay this bill"><Wallet className="w-4 h-4" /></button>
                        )}
                        {b.status === "unpaid" && (
                          <button onClick={() => cancelBill(b)} className="text-red-600 hover:text-red-900" title="Cancel bill"><Ban className="w-4 h-4" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      )}

      {supplierForm && (
        <Modal title={supplierForm.id ? "Edit Supplier" : "Add Supplier"} onClose={() => setSupplierForm(null)}>
          <form onSubmit={saveSupplier} className="space-y-4">
            <ErrorBanner message={formError} />
            <Field label="Name *"><input required value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} className={inputClass} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} className={inputClass} /></Field>
              <Field label="Email"><input type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} className={inputClass} /></Field>
              <Field label="GSTIN"><input value={supplierForm.gstin} onChange={(e) => setSupplierForm({ ...supplierForm, gstin: e.target.value })} className={inputClass} /></Field>
              <Field label="Opening balance (₹)" hint="Already owed to them; use a negative amount for an advance you paid"><input type="number" step="0.01" value={supplierForm.opening_balance} onChange={(e) => setSupplierForm({ ...supplierForm, opening_balance: e.target.value })} className={inputClass} /></Field>
            </div>
            <Field label="Address"><input value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} className={inputClass} /></Field>
            <Field label="Notes"><input value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} className={inputClass} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setSupplierForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving} className={primaryButton}>{isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save</button>
            </div>
          </form>
        </Modal>
      )}

      {billForm && (
        <Modal title="Add Purchase Bill" onClose={() => setBillForm(null)}>
          <form onSubmit={saveBill} className="space-y-4">
            <ErrorBanner message={formError} />
            <Field label="Supplier *">
              <select required value={billForm.supplier_id} onChange={(e) => setBillForm({ ...billForm, supplier_id: e.target.value })} className={inputClass}>
                <option value="">Choose supplier…</option>
                {suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bill number"><input value={billForm.bill_number} onChange={(e) => setBillForm({ ...billForm, bill_number: e.target.value })} className={inputClass} /></Field>
              <Field label="Amount (₹) *"><input type="number" min="0.01" step="0.01" required value={billForm.amount} onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })} className={inputClass} /></Field>
              <Field label="Bill date"><input type="date" required value={billForm.bill_date} onChange={(e) => setBillForm({ ...billForm, bill_date: e.target.value })} className={inputClass} /></Field>
              <Field label="Due date"><input type="date" value={billForm.due_date} onChange={(e) => setBillForm({ ...billForm, due_date: e.target.value })} className={inputClass} /></Field>
            </div>
            <Field label="Notes"><input value={billForm.notes} onChange={(e) => setBillForm({ ...billForm, notes: e.target.value })} className={inputClass} placeholder="e.g. 50 bags rice" /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setBillForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving} className={primaryButton}>{isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save Bill</button>
            </div>
          </form>
        </Modal>
      )}

      {payForm && (
        <Modal title="Pay Supplier" onClose={() => setPayForm(null)}>
          <form onSubmit={savePayment} className="space-y-4">
            <ErrorBanner message={formError} />
            <Field label="Supplier *">
              <select required value={payForm.supplier_id} onChange={(e) => setPayForm({ ...payForm, supplier_id: e.target.value, bill_id: "", amount: "" })} className={inputClass}>
                <option value="">Choose supplier…</option>
                {suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name} — owes {formatCurrency(outstandingOf(s.id))}</option>)}
              </select>
            </Field>
            <Field label="Against bill" hint="Leave as 'On account' to pay against the opening balance or overall dues.">
              <select
                value={payForm.bill_id}
                onChange={(e) => {
                  const bill = bills.find((b) => b.id === e.target.value);
                  setPayForm({ ...payForm, bill_id: e.target.value, amount: bill ? String(bill.amount_due) : payForm.amount });
                }}
                className={inputClass}
              >
                <option value="">On account</option>
                {openBillsFor(payForm.supplier_id).map((b) => (
                  <option key={b.id} value={b.id}>{b.bill_number || "Bill"} · {formatDate(b.bill_date)} · due {formatCurrency(b.amount_due)}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₹) *"><input type="number" min="0.01" step="0.01" required value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className={inputClass} /></Field>
              <Field label="Paid on"><input type="date" required value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} className={inputClass} /></Field>
            </div>
            <Field label="Payment mode"><ModeSelect value={payForm.payment_mode} onChange={(m) => setPayForm({ ...payForm, payment_mode: m, account_id: initialAccountId(accounts, m) })} /></Field>
            <Field label="Account"><AccountSelect accounts={accounts} mode={payForm.payment_mode} value={payForm.account_id} onChange={(id) => setPayForm({ ...payForm, account_id: id })} /></Field>
            <Field label="Reference (UPI ref / cheque no.)"><input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} className={inputClass} /></Field>
            <Field label="Notes"><input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className={inputClass} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPayForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving || accountsFor(accounts, payForm.payment_mode).length === 0} className={primaryButton}>{isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Record Payment</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
