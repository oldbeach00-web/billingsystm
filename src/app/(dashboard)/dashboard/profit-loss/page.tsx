"use client";

import { useMemo, useState } from "react";
import { cn, formatCurrency } from "@/lib/utils";
import { localDateString, round2 } from "@/lib/billing";
import {
  PAYMENT_MODES,
  computeProfitAndLoss,
  inRange,
  loadAll,
  modeLabel,
  type FinanceEntry,
  type LedgerRow,
  type PaymentMode,
  type SalaryPayment,
  type SupplierBill,
} from "@/lib/finance";
import {
  DateRange,
  ErrorBanner,
  Field,
  Loading,
  ModeBadge,
  PageHeader,
  StatCard,
  cardClass,
  inputClass,
} from "@/components/finance/ui";
import { useLoad } from "@/components/finance/useLoad";

interface BilledInvoice {
  id: string;
  issue_date: string;
  total_amount: number;
  status: string;
}

const loadPage = async () => {
  const [ledger, entries, invoices, bills, salaries] = await Promise.all([
    loadAll<LedgerRow>("money_ledger", "entry_date"),
    loadAll<FinanceEntry>("finance_entries", "entry_date"),
    loadAll<BilledInvoice>("invoices", "issue_date", true, (q) =>
      q.not("status", "in", "(draft,cancelled)")
    ),
    loadAll<SupplierBill>("supplier_bills", "bill_date", true, (q) => q.neq("status", "cancelled")),
    loadAll<SalaryPayment>("salary_payments", "salary_month"),
  ]);
  return { ledger, entries, invoices, bills, salaries };
};

function Row({
  label,
  amount,
  strong = false,
  negative = false,
  indent = false,
}: {
  label: string;
  amount: number;
  strong?: boolean;
  negative?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between py-2 text-sm",
        strong && "font-semibold border-t border-gray-200 dark:border-gray-700",
        indent && "pl-4 text-gray-500 dark:text-gray-400"
      )}
    >
      <span>{label}</span>
      <span className={cn(negative && "text-red-600 dark:text-red-400")}>
        {negative ? "− " : ""}
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

export default function ProfitLossPage() {
  const { data, error, isLoading } = useLoad(loadPage, {
    ledger: [] as LedgerRow[],
    entries: [] as FinanceEntry[],
    invoices: [] as BilledInvoice[],
    bills: [] as SupplierBill[],
    salaries: [] as SalaryPayment[],
  });

  const [from, setFrom] = useState(() => {
    const d = new Date();
    return localDateString(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [to, setTo] = useState(() => localDateString());
  const [mode, setMode] = useState<"all" | PaymentMode>("all");

  const pl = useMemo(
    () => computeProfitAndLoss(data.ledger, data.entries, from, to, mode),
    [data, from, to, mode]
  );

  // Accrual view: what was billed, whether or not it has been paid yet
  const accrual = useMemo(() => {
    const sales = round2(
      data.invoices.filter((i) => inRange(i.issue_date, from, to)).reduce((s, i) => s + Number(i.total_amount), 0)
    );
    const purchases = round2(
      data.bills.filter((b) => inRange(b.bill_date, from, to)).reduce((s, b) => s + b.amount, 0)
    );
    // Salaries by the month they are for (not the day they were paid)
    const salaries = round2(
      data.salaries
        .filter((s) => inRange(s.salary_month, from ? `${from.slice(0, 7)}-01` : "", to))
        .reduce((sum, s) => sum + s.amount, 0)
    );
    const all = computeProfitAndLoss(data.ledger, data.entries, from, to, "all");
    return {
      sales,
      otherIncome: all.otherIncome,
      purchases,
      salaries,
      expenses: all.expenses,
      net: round2(sales + all.otherIncome - purchases - salaries - all.expenses),
    };
  }, [data, from, to]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit & Loss"
        subtitle="Money received and paid in a period, by Cash, UPI or Bank"
      />

      <ErrorBanner message={error} />

      <div className={cn(cardClass, "p-4 flex flex-wrap items-end gap-3")}>
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <Field label="Payment mode">
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className={inputClass}>
            <option value="all">All modes</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label} only</option>
            ))}
          </select>
        </Field>
      </div>

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total income" value={pl.totalIncome} tone="good" hint={mode === "all" ? "All modes" : `${modeLabel(mode)} only`} />
            <StatCard label="Total expenses" value={pl.totalExpenses} tone="bad" />
            <StatCard
              label={pl.netProfit >= 0 ? "Net profit" : "Net loss"}
              value={Math.abs(pl.netProfit)}
              tone={pl.netProfit >= 0 ? "good" : "bad"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className={cn(cardClass, "p-5")}>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                Cash-basis statement {mode !== "all" && <ModeBadge mode={mode} />}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Money actually received and paid, by date. Supplier payments count as expenses when paid
                (stock still on the shelf is not valued). Refunds reduce sales on the day they are paid back.
                Transfers between your own accounts are not counted.
              </p>
              <div className="text-gray-700 dark:text-gray-300">
                <p className="text-xs font-semibold uppercase text-gray-500 mt-2">Income</p>
                <Row label="Received from customers" amount={pl.salesReceived} />
                {pl.refunds > 0 && <Row label="Less: refunds on cancelled invoices" amount={pl.refunds} negative indent />}
                <Row label="Sales collected (net)" amount={pl.salesCollected} />
                <Row label="Other income" amount={pl.otherIncome} />
                <Row label="Total income" amount={pl.totalIncome} strong />

                <p className="text-xs font-semibold uppercase text-gray-500 mt-4">Expenses</p>
                <Row label="Paid to suppliers" amount={pl.supplierPayments} />
                <Row label="Staff salaries" amount={pl.salaries} />
                <Row label="Other expenses" amount={pl.expenses} />
                {pl.expenseByCategory.map((c) => (
                  <Row key={c.category} label={c.category} amount={c.amount} indent />
                ))}
                <Row label="Total expenses" amount={pl.totalExpenses} strong />

                <Row
                  label={pl.netProfit >= 0 ? "Net profit" : "Net loss"}
                  amount={Math.abs(pl.netProfit)}
                  negative={pl.netProfit < 0}
                  strong
                />
              </div>
            </div>

            <div className="space-y-6">
              <div className={cn(cardClass, "overflow-x-auto")}>
                <div className="p-5 pb-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white">By payment mode</h3>
                </div>
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-2 text-left">Mode</th>
                      <th className="px-4 py-2 text-right">Money in</th>
                      <th className="px-4 py-2 text-right">Money out</th>
                      <th className="px-4 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                    {pl.byMode.map((m) => (
                      <tr key={m.mode}>
                        <td className="px-4 py-2"><ModeBadge mode={m.mode} /></td>
                        <td className="px-4 py-2 text-right text-emerald-600">{formatCurrency(m.moneyIn)}</td>
                        <td className="px-4 py-2 text-right text-red-600">{formatCurrency(m.moneyOut)}</td>
                        <td className="px-4 py-2 text-right font-semibold">{formatCurrency(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={cn(cardClass, "p-5")}>
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Billed basis (all modes)</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Sales and purchases by bill date and salaries by the month they are for, including amounts not
                  yet collected or paid. Other income and expenses are by entry date.
                </p>
                <div className="text-gray-700 dark:text-gray-300">
                  <Row label="Sales billed" amount={accrual.sales} />
                  <Row label="Other income" amount={accrual.otherIncome} />
                  <Row label="Purchases billed by suppliers" amount={accrual.purchases} negative />
                  <Row label="Staff salaries" amount={accrual.salaries} negative />
                  <Row label="Other expenses" amount={accrual.expenses} negative />
                  <Row
                    label={accrual.net >= 0 ? "Net profit" : "Net loss"}
                    amount={Math.abs(accrual.net)}
                    negative={accrual.net < 0}
                    strong
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
