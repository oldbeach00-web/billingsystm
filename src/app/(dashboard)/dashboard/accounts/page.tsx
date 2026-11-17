"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, ArrowLeftRight, Trash2, Loader2, Landmark } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { localDateString, round2 } from "@/lib/billing";
import {
  PAYMENT_MODES,
  check,
  fdb,
  inRange,
  loadAll,
  modeLabel,
  type AccountBalance,
  type AccountTransfer,
  type FinanceAccount,
  type LedgerRow,
  type PaymentMode,
} from "@/lib/finance";
import {
  DateRange,
  ErrorBanner,
  Field,
  Loading,
  ModeBadge,
  Modal,
  PageHeader,
  StatCard,
  cardClass,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/finance/ui";
import { useLoad } from "@/components/finance/useLoad";

const SOURCE_LABELS: Record<string, string> = {
  customer_payment: "Customer payment",
  income: "Income",
  expense: "Expense",
  salary: "Salary",
  supplier_payment: "Supplier payment",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
};

const loadPage = async () => {
  const [accounts, balances, ledger, transfers] = await Promise.all([
    loadAll<FinanceAccount>("finance_accounts", "name"),
    loadAll<AccountBalance>("account_balances", "name"),
    loadAll<LedgerRow>("money_ledger", "entry_date"),
    loadAll<AccountTransfer>("account_transfers", "transfer_date", false),
  ]);
  return { accounts, balances, ledger, transfers };
};

type AccountForm = {
  id: string | null;
  name: string;
  kind: PaymentMode;
  bank_name: string;
  account_number: string;
  ifsc: string;
  upi_id: string;
  opening_balance: string;
  is_default: boolean;
  notes: string;
};

export default function AccountsPage() {
  const { data, error, setError, isLoading, reload } = useLoad(loadPage, {
    accounts: [] as FinanceAccount[],
    balances: [] as AccountBalance[],
    ledger: [] as LedgerRow[],
    transfers: [] as AccountTransfer[],
  });
  const { accounts, balances, ledger, transfers } = data;

  const [selectedId, setSelectedId] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [accountForm, setAccountForm] = useState<AccountForm | null>(null);
  const [transferForm, setTransferForm] = useState<{
    from_account_id: string;
    to_account_id: string;
    amount: string;
    transfer_date: string;
    notes: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = selectedId || balances[0]?.id || "";
  const balanceOf = (id: string) => balances.find((b) => b.id === id)?.balance ?? 0;
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  const totalsByMode = PAYMENT_MODES.map((m) => ({
    ...m,
    balance: round2(balances.filter((b) => b.kind === m.value && b.is_active).reduce((s, b) => s + b.balance, 0)),
  }));

  // Statement with running balance: opening + everything before the range
  // gives the balance brought forward.
  const statement = useMemo(() => {
    const account = balances.find((b) => b.id === selected);
    if (!account) return { forward: 0, rows: [] as (LedgerRow & { running: number })[], closing: 0 };
    const all = ledger
      .filter((r) => r.account_id === selected)
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0));
    let running = account.opening_balance;
    for (const r of all) if (from && r.entry_date < from) running += r.direction * r.amount;
    const forward = round2(running);
    const rows = all
      .filter((r) => inRange(r.entry_date, from, to))
      .map((r) => {
        running = round2(running + r.direction * r.amount);
        return { ...r, running };
      });
    return { forward, rows, closing: round2(running) };
  }, [ledger, balances, selected, from, to]);

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

  const saveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountForm) return;
    if (!accountForm.name.trim()) return setFormError("Enter an account name.");
    const opening = round2(parseFloat(accountForm.opening_balance) || 0);
    const payload = {
      name: accountForm.name.trim(),
      kind: accountForm.kind,
      bank_name: accountForm.bank_name.trim() || null,
      account_number: accountForm.account_number.trim() || null,
      ifsc: accountForm.ifsc.trim().toUpperCase() || null,
      upi_id: accountForm.upi_id.trim() || null,
      opening_balance: opening,
      notes: accountForm.notes.trim() || null,
    };
    void run(async () => {
      // Only one default account per mode: clear the old default first
      if (accountForm.is_default) {
        const { error: err } = await fdb("finance_accounts")
          .update({ is_default: false })
          .eq("kind", accountForm.kind)
          .eq("is_default", true)
          .neq("id", accountForm.id ?? "00000000-0000-0000-0000-000000000000");
        check(err, "Could not update the default account");
      }
      const full = { ...payload, is_default: accountForm.is_default };
      const { error: err } = accountForm.id
        ? await fdb("finance_accounts").update(full).eq("id", accountForm.id)
        : await fdb("finance_accounts").insert([full]);
      check(err, "Could not save the account");
    }, () => setAccountForm(null));
  };

  const toggleActive = async (a: FinanceAccount) => {
    if (a.is_active && a.is_default) {
      setError("Make another account the default for this mode before closing this one.");
      return;
    }
    const { error: err } = await fdb("finance_accounts").update({ is_active: !a.is_active }).eq("id", a.id);
    if (err) setError(err.message);
    else await reload();
  };

  const saveTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferForm) return;
    const amount = round2(parseFloat(transferForm.amount));
    if (!transferForm.from_account_id || !transferForm.to_account_id)
      return setFormError("Choose both accounts.");
    if (transferForm.from_account_id === transferForm.to_account_id)
      return setFormError("Choose two different accounts.");
    if (!(amount > 0)) return setFormError("Enter an amount greater than 0.");
    void run(async () => {
      const { error: err } = await fdb("account_transfers").insert([
        {
          from_account_id: transferForm.from_account_id,
          to_account_id: transferForm.to_account_id,
          amount,
          transfer_date: transferForm.transfer_date,
          notes: transferForm.notes.trim() || null,
        },
      ]);
      check(err, "Could not save the transfer");
    }, () => setTransferForm(null));
  };

  const deleteTransfer = async (t: AccountTransfer) => {
    if (!window.confirm(`Delete the ${formatCurrency(t.amount)} transfer?`)) return;
    const { error: err } = await fdb("account_transfers").delete().eq("id", t.id);
    if (err) setError(err.message);
    else await reload();
  };

  const activeAccounts = accounts.filter((a) => a.is_active);

  return (
    <div className="space-y-6">
      <PageHeader title="Bank & Payment Accounts" subtitle="Cash, UPI and bank balances, transfers and account statements">
        <button
          onClick={() => {
            setFormError(null);
            setTransferForm({ from_account_id: "", to_account_id: "", amount: "", transfer_date: localDateString(), notes: "" });
          }}
          className={secondaryButton}
        >
          <ArrowLeftRight className="w-4 h-4" /> Transfer
        </button>
        <button
          onClick={() => {
            setFormError(null);
            setAccountForm({ id: null, name: "", kind: "bank", bank_name: "", account_number: "", ifsc: "", upi_id: "", opening_balance: "", is_default: false, notes: "" });
          }}
          className={primaryButton}
        >
          <Plus className="w-4 h-4" /> Add Account
        </button>
      </PageHeader>

      <ErrorBanner message={error} />

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {totalsByMode.map((m) => (
              <StatCard key={m.value} label={`${m.label} balance`} value={m.balance} tone={m.balance < 0 ? "bad" : "default"} />
            ))}
          </div>

          <div className={cn(cardClass, "overflow-x-auto")}>
            <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Account</th>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-left">Details</th>
                  <th className="px-4 py-3 text-right">Opening</th>
                  <th className="px-4 py-3 text-right">In</th>
                  <th className="px-4 py-3 text-right">Out</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                {accounts.map((a) => {
                  const b = balances.find((x) => x.id === a.id);
                  return (
                    <tr key={a.id} className={cn("cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50", !a.is_active && "opacity-50", a.id === selected && "bg-indigo-50/50 dark:bg-indigo-900/10")} onClick={() => setSelectedId(a.id)}>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                        {a.name}
                        {a.is_default && <span className="ml-2 text-xs text-indigo-600">default</span>}
                        {!a.is_active && <span className="ml-2 text-xs text-gray-500">closed</span>}
                      </td>
                      <td className="px-4 py-3"><ModeBadge mode={a.kind} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {[a.bank_name, a.account_number && `A/c ${a.account_number}`, a.ifsc, a.upi_id].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(a.opening_balance)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{formatCurrency(b?.total_in ?? 0)}</td>
                      <td className="px-4 py-3 text-right text-red-600">{formatCurrency(b?.total_out ?? 0)}</td>
                      <td className={cn("px-4 py-3 text-right font-bold", (b?.balance ?? 0) < 0 ? "text-red-600" : "text-gray-900 dark:text-white")}>{formatCurrency(b?.balance ?? 0)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setFormError(null);
                            setAccountForm({ id: a.id, name: a.name, kind: a.kind, bank_name: a.bank_name ?? "", account_number: a.account_number ?? "", ifsc: a.ifsc ?? "", upi_id: a.upi_id ?? "", opening_balance: String(a.opening_balance), is_default: a.is_default, notes: a.notes ?? "" });
                          }}
                          className="text-indigo-600 hover:text-indigo-900 mr-3"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => toggleActive(a)} className="text-xs text-gray-500 hover:text-gray-800">
                          {a.is_active ? "Close" : "Reopen"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={cn(cardClass, "p-4 space-y-4")}>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Statement for">
                <select value={selected} onChange={(e) => setSelectedId(e.target.value)} className={inputClass}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({modeLabel(a.kind)})</option>
                  ))}
                </select>
              </Field>
              <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">Details</th>
                    <th className="px-4 py-2 text-right">In</th>
                    <th className="px-4 py-2 text-right">Out</th>
                    <th className="px-4 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                  <tr className="bg-gray-50/50 dark:bg-gray-900/20">
                    <td className="px-4 py-2" colSpan={5}>{from ? "Balance brought forward" : "Opening balance"}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatCurrency(statement.forward)}</td>
                  </tr>
                  {statement.rows.map((r) => (
                    <tr key={`${r.source}-${r.source_id}`}>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{SOURCE_LABELS[r.source] ?? r.source}</td>
                      <td className="px-4 py-2">{r.description}{r.party ? ` · ${r.party}` : ""}</td>
                      <td className="px-4 py-2 text-right text-emerald-600">{r.direction > 0 ? formatCurrency(r.amount) : ""}</td>
                      <td className="px-4 py-2 text-right text-red-600">{r.direction < 0 ? formatCurrency(r.amount) : ""}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatCurrency(r.running)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="px-4 py-2" colSpan={5}>Closing balance</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(statement.closing)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className={cn(cardClass, "overflow-x-auto")}>
            <div className="px-4 pt-4 pb-2 font-semibold text-gray-900 dark:text-white">Transfers</div>
            <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">From</th>
                  <th className="px-4 py-2 text-left">To</th>
                  <th className="px-4 py-2 text-left">Notes</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                {transfers.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No transfers yet. Use Transfer to record cash deposited in the bank, etc.</td></tr>
                )}
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2">{formatDate(t.transfer_date)}</td>
                    <td className="px-4 py-2">{accountName(t.from_account_id)}</td>
                    <td className="px-4 py-2">{accountName(t.to_account_id)}</td>
                    <td className="px-4 py-2">{t.notes || "—"}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatCurrency(t.amount)}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => deleteTransfer(t)} className="text-red-600 hover:text-red-900" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {accountForm && (
        <Modal title={accountForm.id ? "Edit Account" : "Add Account"} onClose={() => setAccountForm(null)}>
          <form onSubmit={saveAccount} className="space-y-4">
            <ErrorBanner message={formError} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Account name *">
                <input required value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} className={inputClass} placeholder="e.g. SBI Current" />
              </Field>
              <Field label="Type">
                <select value={accountForm.kind} onChange={(e) => setAccountForm({ ...accountForm, kind: e.target.value as PaymentMode })} className={inputClass} disabled={!!accountForm.id}>
                  {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
            </div>
            {accountForm.kind === "bank" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bank name"><input value={accountForm.bank_name} onChange={(e) => setAccountForm({ ...accountForm, bank_name: e.target.value })} className={inputClass} /></Field>
                <Field label="IFSC"><input value={accountForm.ifsc} onChange={(e) => setAccountForm({ ...accountForm, ifsc: e.target.value })} className={inputClass} /></Field>
                <Field label="Account number"><input value={accountForm.account_number} onChange={(e) => setAccountForm({ ...accountForm, account_number: e.target.value })} className={inputClass} /></Field>
              </div>
            )}
            {accountForm.kind === "upi" && (
              <Field label="UPI ID"><input value={accountForm.upi_id} onChange={(e) => setAccountForm({ ...accountForm, upi_id: e.target.value })} className={inputClass} placeholder="shop@okaxis" /></Field>
            )}
            <Field label="Opening balance (₹)" hint="Money already in this account before you started using this page.">
              <input type="number" step="0.01" value={accountForm.opening_balance} onChange={(e) => setAccountForm({ ...accountForm, opening_balance: e.target.value })} className={inputClass} />
            </Field>
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" className="mt-1" checked={accountForm.is_default} onChange={(e) => setAccountForm({ ...accountForm, is_default: e.target.checked })} />
              <span>Default {modeLabel(accountForm.kind)} account — customer payments and entries without an account go here.</span>
            </label>
            <Field label="Notes"><input value={accountForm.notes} onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })} className={inputClass} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAccountForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving} className={primaryButton}>{isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save</button>
            </div>
          </form>
        </Modal>
      )}

      {transferForm && (
        <Modal title="Transfer between accounts" onClose={() => setTransferForm(null)}>
          <form onSubmit={saveTransfer} className="space-y-4">
            <ErrorBanner message={formError} />
            <Field label="From">
              <select required value={transferForm.from_account_id} onChange={(e) => setTransferForm({ ...transferForm, from_account_id: e.target.value })} className={inputClass}>
                <option value="">Choose account…</option>
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(balanceOf(a.id))}</option>)}
              </select>
            </Field>
            <Field label="To">
              <select required value={transferForm.to_account_id} onChange={(e) => setTransferForm({ ...transferForm, to_account_id: e.target.value })} className={inputClass}>
                <option value="">Choose account…</option>
                {activeAccounts.filter((a) => a.id !== transferForm.from_account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₹)"><input type="number" min="0.01" step="0.01" required value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} className={inputClass} /></Field>
              <Field label="Date"><input type="date" required value={transferForm.transfer_date} onChange={(e) => setTransferForm({ ...transferForm, transfer_date: e.target.value })} className={inputClass} /></Field>
            </div>
            <Field label="Notes"><input value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} className={inputClass} placeholder="e.g. Cash deposited at branch" /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setTransferForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving} className={primaryButton}>{isSaving && <Loader2 className="w-4 h-4 animate-spin" />} <Landmark className="w-4 h-4" /> Transfer</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
