"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Archive, Trash2, Wallet, Loader2 } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { localDateString, round2 } from "@/lib/billing";
import {
  check,
  fdb,
  loadAll,
  monthLabel,
  monthStart,
  type FinanceAccount,
  type PaymentMode,
  type SalaryPayment,
  type Staff,
} from "@/lib/finance";
import {
  AccountSelect,
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
  const [staff, payments, accounts] = await Promise.all([
    loadAll<Staff>("staff", "name"),
    loadAll<SalaryPayment>("salary_payments", "payment_date", false),
    loadAll<FinanceAccount>("finance_accounts", "name"),
  ]);
  return { staff, payments, accounts };
};

const currentMonth = () => localDateString().slice(0, 7);

export default function StaffPage() {
  const { data, error, setError, isLoading, reload } = useLoad(loadPage, {
    staff: [] as Staff[],
    payments: [] as SalaryPayment[],
    accounts: [] as FinanceAccount[],
  });
  const { staff, payments, accounts } = data;

  const [month, setMonth] = useState(currentMonth);
  const [showArchived, setShowArchived] = useState(false);

  const [staffForm, setStaffForm] = useState<{
    id: string | null;
    name: string;
    phone: string;
    designation: string;
    monthly_salary: string;
    joining_date: string;
    notes: string;
  } | null>(null);

  const [payForm, setPayForm] = useState<{
    staff_id: string;
    month: string;
    amount: string;
    payment_date: string;
    payment_mode: PaymentMode;
    account_id: string;
    notes: string;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Salary paid per staff member per month ("<staffId>|YYYY-MM")
  const paidMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      const key = `${p.staff_id}|${p.salary_month.slice(0, 7)}`;
      map.set(key, round2((map.get(key) ?? 0) + p.amount));
    }
    return map;
  }, [payments]);

  const paidFor = (staffId: string, yyyyMm: string) => paidMap.get(`${staffId}|${yyyyMm}`) ?? 0;

  const rows = useMemo(
    () =>
      staff
        .filter((s) => showArchived || s.is_active)
        .map((s) => {
          const paid = paidMap.get(`${s.id}|${month}`) ?? 0;
          return { ...s, paid, pending: round2(Math.max(0, s.monthly_salary - paid)) };
        }),
    [staff, paidMap, month, showArchived]
  );

  const monthPayments = payments.filter((p) => p.salary_month.slice(0, 7) === month);
  const totals = {
    payroll: round2(rows.filter((r) => r.is_active).reduce((s, r) => s + r.monthly_salary, 0)),
    paid: round2(monthPayments.reduce((s, p) => s + p.amount, 0)),
    pending: round2(rows.filter((r) => r.is_active).reduce((s, r) => s + r.pending, 0)),
  };

  const staffName = (id: string) => staff.find((s) => s.id === id)?.name ?? "—";

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

  const saveStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffForm) return;
    const salary = round2(parseFloat(staffForm.monthly_salary) || 0);
    if (!staffForm.name.trim()) return setFormError("Enter the staff member's name.");
    if (salary < 0) return setFormError("Salary cannot be negative.");
    const payload = {
      name: staffForm.name.trim(),
      phone: staffForm.phone.trim() || null,
      designation: staffForm.designation.trim() || null,
      monthly_salary: salary,
      joining_date: staffForm.joining_date || null,
      notes: staffForm.notes.trim() || null,
    };
    void run(async () => {
      const { error: err } = staffForm.id
        ? await fdb("staff").update(payload).eq("id", staffForm.id)
        : await fdb("staff").insert([payload]);
      check(err, "Could not save staff");
    }, () => setStaffForm(null));
  };

  const archive = async (s: Staff) => {
    const action = s.is_active ? "Archive" : "Restore";
    if (!window.confirm(`${action} ${s.name}? Their salary history is kept.`)) return;
    const { error: err } = await fdb("staff").update({ is_active: !s.is_active }).eq("id", s.id);
    if (err) setError(err.message);
    else await reload();
  };

  const openPay = (s: Staff & { pending: number }) => {
    setFormError(null);
    setPayForm({
      staff_id: s.id,
      month,
      amount: s.pending > 0 ? String(s.pending) : "",
      payment_date: localDateString(),
      payment_mode: "cash",
      account_id: "",
      notes: "",
    });
  };

  const savePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payForm) return;
    const amount = round2(parseFloat(payForm.amount));
    if (!payForm.staff_id) return setFormError("Choose a staff member.");
    if (!(amount > 0)) return setFormError("Enter an amount greater than 0.");
    void run(async () => {
      const { error: err } = await fdb("salary_payments").insert([
        {
          staff_id: payForm.staff_id,
          salary_month: monthStart(payForm.month),
          payment_date: payForm.payment_date,
          amount,
          payment_mode: payForm.payment_mode,
          account_id: payForm.account_id || null,
          notes: payForm.notes.trim() || null,
        },
      ]);
      check(err, "Could not record the salary payment");
    }, () => setPayForm(null));
  };

  const deletePayment = async (p: SalaryPayment) => {
    if (!window.confirm(`Delete the ${formatCurrency(p.amount)} salary payment to ${staffName(p.staff_id)}?`)) return;
    const { error: err } = await fdb("salary_payments").delete().eq("id", p.id);
    if (err) setError(err.message);
    else await reload();
  };

  const selectedStaff = payForm ? staff.find((s) => s.id === payForm.staff_id) : undefined;
  const alreadyPaid = payForm && payForm.staff_id ? paidFor(payForm.staff_id, payForm.month) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Staff & Salaries" subtitle="Manage staff and pay salaries by Cash, UPI or Bank">
        <button
          onClick={() => {
            setFormError(null);
            setPayForm({ staff_id: "", month, amount: "", payment_date: localDateString(), payment_mode: "cash", account_id: "", notes: "" });
          }}
          className={secondaryButton}
        >
          <Wallet className="w-4 h-4" /> Pay Salary
        </button>
        <button
          onClick={() => {
            setFormError(null);
            setStaffForm({ id: null, name: "", phone: "", designation: "", monthly_salary: "", joining_date: "", notes: "" });
          }}
          className={primaryButton}
        >
          <Plus className="w-4 h-4" /> Add Staff
        </button>
      </PageHeader>

      <ErrorBanner message={error} />

      <div className={cn(cardClass, "p-4 flex flex-wrap items-end gap-4")}>
        <Field label="Salary month">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived staff
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={`Payroll · ${monthLabel(monthStart(month))}`} value={totals.payroll} />
        <StatCard label="Paid" value={totals.paid} tone="good" />
        <StatCard label="Pending" value={totals.pending} tone={totals.pending > 0 ? "bad" : "good"} />
      </div>

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className={cn(cardClass, "overflow-x-auto")}>
            <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Designation</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-right">Monthly salary</th>
                  <th className="px-4 py-3 text-right">Paid ({monthLabel(monthStart(month))})</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No staff yet. Add your first staff member.</td></tr>
                )}
                {rows.map((s) => (
                  <tr key={s.id} className={cn(!s.is_active && "opacity-50")}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{s.name}</td>
                    <td className="px-4 py-3">{s.designation || "—"}</td>
                    <td className="px-4 py-3">{s.phone || "—"}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(s.monthly_salary)}</td>
                    <td className="px-4 py-3 text-right text-emerald-600">{formatCurrency(s.paid)}</td>
                    <td className={cn("px-4 py-3 text-right font-semibold", s.pending > 0 ? "text-red-600" : "text-gray-400")}>{formatCurrency(s.pending)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {s.is_active && (
                        <button onClick={() => openPay(s)} className="text-emerald-600 hover:text-emerald-800 mr-3" title="Pay salary"><Wallet className="w-4 h-4" /></button>
                      )}
                      <button
                        onClick={() => {
                          setFormError(null);
                          setStaffForm({ id: s.id, name: s.name, phone: s.phone ?? "", designation: s.designation ?? "", monthly_salary: String(s.monthly_salary), joining_date: s.joining_date ?? "", notes: s.notes ?? "" });
                        }}
                        className="text-indigo-600 hover:text-indigo-900 mr-3"
                        title="Edit"
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

          <div className={cn(cardClass, "overflow-x-auto")}>
            <div className="px-4 pt-4 pb-2 font-semibold text-gray-900 dark:text-white">Salary payments · {monthLabel(monthStart(month))}</div>
            <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Paid on</th>
                  <th className="px-4 py-3 text-left">Staff</th>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                {monthPayments.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No salary paid for this month yet.</td></tr>
                )}
                {monthPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">{formatDate(p.payment_date)}</td>
                    <td className="px-4 py-3">{staffName(p.staff_id)}</td>
                    <td className="px-4 py-3"><ModeBadge mode={p.payment_mode} /></td>
                    <td className="px-4 py-3">{p.notes || "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => deletePayment(p)} className="text-red-600 hover:text-red-900" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {staffForm && (
        <Modal title={staffForm.id ? "Edit Staff" : "Add Staff"} onClose={() => setStaffForm(null)}>
          <form onSubmit={saveStaff} className="space-y-4">
            <ErrorBanner message={formError} />
            <Field label="Name *">
              <input required value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Designation">
                <input value={staffForm.designation} onChange={(e) => setStaffForm({ ...staffForm, designation: e.target.value })} className={inputClass} placeholder="e.g. Cashier" />
              </Field>
              <Field label="Phone">
                <input value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Monthly salary (₹)">
                <input type="number" min="0" step="0.01" value={staffForm.monthly_salary} onChange={(e) => setStaffForm({ ...staffForm, monthly_salary: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Joining date">
                <input type="date" value={staffForm.joining_date} onChange={(e) => setStaffForm({ ...staffForm, joining_date: e.target.value })} className={inputClass} />
              </Field>
            </div>
            <Field label="Notes">
              <input value={staffForm.notes} onChange={(e) => setStaffForm({ ...staffForm, notes: e.target.value })} className={inputClass} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setStaffForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving} className={primaryButton}>{isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save</button>
            </div>
          </form>
        </Modal>
      )}

      {payForm && (
        <Modal title="Pay Salary" onClose={() => setPayForm(null)}>
          <form onSubmit={savePayment} className="space-y-4">
            <ErrorBanner message={formError} />
            <Field label="Staff *">
              <select
                required
                value={payForm.staff_id}
                onChange={(e) => {
                  const s = staff.find((x) => x.id === e.target.value);
                  const pending = s ? round2(Math.max(0, s.monthly_salary - paidFor(s.id, payForm.month))) : 0;
                  setPayForm({ ...payForm, staff_id: e.target.value, amount: pending > 0 ? String(pending) : "" });
                }}
                className={inputClass}
              >
                <option value="">Choose staff…</option>
                {staff.filter((s) => s.is_active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Salary for month">
                <input type="month" required value={payForm.month} onChange={(e) => setPayForm({ ...payForm, month: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Paid on">
                <input type="date" required value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} className={inputClass} />
              </Field>
            </div>
            <Field
              label="Amount (₹)"
              hint={selectedStaff ? `Monthly salary ${formatCurrency(selectedStaff.monthly_salary)} · already paid ${formatCurrency(alreadyPaid)} for this month` : undefined}
            >
              <input type="number" min="0.01" step="0.01" required value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Payment mode">
              <ModeSelect value={payForm.payment_mode} onChange={(m) => setPayForm({ ...payForm, payment_mode: m, account_id: "" })} />
            </Field>
            <Field label="Account">
              <AccountSelect accounts={accounts} mode={payForm.payment_mode} value={payForm.account_id} onChange={(id) => setPayForm({ ...payForm, account_id: id })} />
            </Field>
            <Field label="Notes">
              <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className={inputClass} placeholder="e.g. advance, bonus" />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPayForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving} className={primaryButton}>{isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Record Payment</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
