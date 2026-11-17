"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { localDateString, round2 } from "@/lib/billing";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_MODES,
  check,
  fdb,
  inRange,
  loadAll,
  type FinanceAccount,
  type FinanceEntry,
  type PaymentMode,
} from "@/lib/finance";
import {
  AccountSelect,
  DateRange,
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

type EntryType = "income" | "expense";

const emptyForm = (type: EntryType) => ({
  entry_type: type,
  entry_date: localDateString(),
  category: "",
  description: "",
  amount: "",
  payment_mode: "cash" as PaymentMode,
  account_id: "",
  reference: "",
});

const loadPage = async () => {
  const [entries, accounts] = await Promise.all([
    loadAll<FinanceEntry>("finance_entries", "entry_date", false),
    loadAll<FinanceAccount>("finance_accounts", "name"),
  ]);
  return { entries, accounts };
};

export default function IncomeExpensePage() {
  const { data, error, setError, isLoading, reload: load } = useLoad(loadPage, {
    entries: [] as FinanceEntry[],
    accounts: [] as FinanceAccount[],
  });
  const { entries, accounts } = data;

  const [from, setFrom] = useState(() => {
    const d = new Date();
    return localDateString(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [to, setTo] = useState(() => localDateString());
  const [typeFilter, setTypeFilter] = useState<"all" | EntryType>("all");
  const [modeFilter, setModeFilter] = useState<"all" | PaymentMode>("all");

  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [form, setForm] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      entries.filter(
        (e) =>
          inRange(e.entry_date, from, to) &&
          (typeFilter === "all" || e.entry_type === typeFilter) &&
          (modeFilter === "all" || e.payment_mode === modeFilter)
      ),
    [entries, from, to, typeFilter, modeFilter]
  );

  const totals = useMemo(() => {
    const sum = (type: EntryType, mode?: PaymentMode) =>
      round2(
        visible
          .filter((e) => e.entry_type === type && (!mode || e.payment_mode === mode))
          .reduce((s, e) => s + e.amount, 0)
      );
    return {
      income: sum("income"),
      expense: sum("expense"),
      byMode: PAYMENT_MODES.map((m) => ({
        ...m,
        income: sum("income", m.value),
        expense: sum("expense", m.value),
      })),
    };
  }, [visible]);

  const openNew = (type: EntryType) => {
    setEditing(null);
    setForm(emptyForm(type));
    setFormError(null);
  };

  const openEdit = (e: FinanceEntry) => {
    setEditing(e);
    setForm({
      entry_type: e.entry_type,
      entry_date: e.entry_date,
      category: e.category,
      description: e.description ?? "",
      amount: String(e.amount),
      payment_mode: e.payment_mode,
      account_id: e.account_id ?? "",
      reference: e.reference ?? "",
    });
    setFormError(null);
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    const amount = round2(parseFloat(form.amount));
    if (!(amount > 0)) return setFormError("Enter an amount greater than 0.");
    if (!form.category.trim()) return setFormError("Choose or type a category.");

    setIsSaving(true);
    setFormError(null);
    try {
      const payload = {
        entry_type: form.entry_type,
        entry_date: form.entry_date,
        category: form.category.trim(),
        description: form.description.trim() || null,
        amount,
        payment_mode: form.payment_mode,
        account_id: form.account_id || null,
        reference: form.reference.trim() || null,
      };
      const { error: err } = editing
        ? await fdb("finance_entries").update(payload).eq("id", editing.id)
        : await fdb("finance_entries").insert([payload]);
      check(err, "Could not save the entry");
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the entry.");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (e: FinanceEntry) => {
    if (!window.confirm(`Delete this ${e.entry_type} of ${formatCurrency(e.amount)}?`)) return;
    try {
      const { error: err } = await fdb("finance_entries").delete().eq("id", e.id);
      check(err, "Could not delete the entry");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the entry.");
    }
  };

  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "Default";

  return (
    <div className="space-y-6">
      <PageHeader title="Income & Expenses" subtitle="Record other income and day-to-day expenses by Cash, UPI or Bank">
        <button onClick={() => openNew("income")} className={secondaryButton}>
          <Plus className="w-4 h-4" /> Add Income
        </button>
        <button onClick={() => openNew("expense")} className={primaryButton}>
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </PageHeader>

      <ErrorBanner message={error} />

      <div className={cn(cardClass, "p-4 flex flex-wrap items-end gap-3")}>
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <Field label="Type">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className={inputClass}>
            <option value="all">Income & expense</option>
            <option value="income">Income only</option>
            <option value="expense">Expense only</option>
          </select>
        </Field>
        <Field label="Mode">
          <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)} className={inputClass}>
            <option value="all">All modes</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Income" value={totals.income} tone="good" />
        <StatCard label="Expenses" value={totals.expense} tone="bad" />
        <StatCard
          label="Net"
          value={round2(totals.income - totals.expense)}
          tone={totals.income >= totals.expense ? "good" : "bad"}
        />
      </div>

      <div className={cn(cardClass, "overflow-x-auto")}>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2 text-left">Mode</th>
              <th className="px-4 py-2 text-right">Income</th>
              <th className="px-4 py-2 text-right">Expense</th>
              <th className="px-4 py-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {totals.byMode.map((m) => (
              <tr key={m.value}>
                <td className="px-4 py-2"><ModeBadge mode={m.value} /></td>
                <td className="px-4 py-2 text-right text-emerald-600">{formatCurrency(m.income)}</td>
                <td className="px-4 py-2 text-right text-red-600">{formatCurrency(m.expense)}</td>
                <td className="px-4 py-2 text-right font-semibold">{formatCurrency(round2(m.income - m.expense))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLoading ? (
        <Loading />
      ) : (
        <div className={cn(cardClass, "overflow-x-auto")}>
          <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-left">Mode / Account</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
              {visible.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No entries in this period.</td></tr>
              )}
              {visible.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(e.entry_date)}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-semibold uppercase", e.entry_type === "income" ? "text-emerald-600" : "text-red-600")}>
                      {e.entry_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">{e.category}</td>
                  <td className="px-4 py-3">{e.description || "—"}{e.reference ? <span className="text-xs text-gray-400"> · {e.reference}</span> : null}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><ModeBadge mode={e.payment_mode} /> <span className="text-xs text-gray-500">{accountName(e.account_id)}</span></td>
                  <td className={cn("px-4 py-3 text-right font-semibold whitespace-nowrap", e.entry_type === "income" ? "text-emerald-600" : "text-red-600")}>
                    {e.entry_type === "income" ? "+" : "−"} {formatCurrency(e.amount)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(e)} className="text-indigo-600 hover:text-indigo-900 mr-3" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(e)} className="text-red-600 hover:text-red-900" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title={`${editing ? "Edit" : "Add"} ${form.entry_type === "income" ? "Income" : "Expense"}`} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-4">
            <ErrorBanner message={formError} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input type="date" required value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Amount (₹)">
                <input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputClass} />
              </Field>
            </div>
            <Field label="Category">
              <input
                list="finance-categories"
                required
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className={inputClass}
                placeholder="Choose or type a category"
              />
              <datalist id="finance-categories">
                {(form.entry_type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Description">
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Payment mode">
              <ModeSelect value={form.payment_mode} onChange={(m) => setForm({ ...form, payment_mode: m, account_id: "" })} />
            </Field>
            <Field label="Account">
              <AccountSelect accounts={accounts} mode={form.payment_mode} value={form.account_id} onChange={(id) => setForm({ ...form, account_id: id })} />
            </Field>
            <Field label="Reference (UPI ref / cheque no.)">
              <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={inputClass} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving} className={primaryButton}>
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
