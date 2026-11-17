"use client";

import Link from "next/link";
import { X, AlertCircle, Loader2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PAYMENT_MODES,
  modeLabel,
  type FinanceAccount,
  type PaymentMode,
} from "@/lib/finance";

export const inputClass =
  "w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

export const primaryButton =
  "inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50";

export const secondaryButton =
  "inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50";

export const cardClass =
  "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700";

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2 text-sm">
      <AlertCircle className="w-5 h-5 flex-shrink-0" />
      {message}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: number;
  tone?: "default" | "good" | "bad";
  hint?: string;
}) {
  return (
    <div className={cn(cardClass, "p-4")}>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {label}
      </p>
      <p
        className={cn(
          "text-xl font-bold mt-1",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "bad" && "text-red-600 dark:text-red-400",
          tone === "default" && "text-gray-900 dark:text-white"
        )}
      >
        {formatCurrency(value)}
      </p>
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
        mode === "cash" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
        mode === "upi" && "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
        mode === "bank" && "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400"
      )}
    >
      {modeLabel(mode)}
    </span>
  );
}

/** Cash / UPI / Bank toggle. */
export function ModeSelect({
  value,
  onChange,
}: {
  value: PaymentMode;
  onChange: (mode: PaymentMode) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PAYMENT_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onChange(m.value)}
          className={cn(
            "px-3 py-2 text-sm font-medium rounded-lg border transition-colors",
            value === m.value
              ? "bg-indigo-600 border-indigo-600 text-white"
              : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50"
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Required account picker for the chosen mode. Bank has no pre-selection;
 * when no active account of the mode exists it shows how to add one and the
 * form must not be saved (see `canSave`).
 */
export function AccountSelect({
  accounts,
  mode,
  value,
  onChange,
}: {
  accounts: FinanceAccount[];
  mode: PaymentMode;
  value: string;
  onChange: (id: string) => void;
}) {
  const options = accounts.filter((a) => a.kind === mode && a.is_active);
  if (options.length === 0) {
    return (
      <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700">
        No {modeLabel(mode)} account has been added yet, so {modeLabel(mode)} payments can&apos;t be
        recorded.{" "}
        <Link href="/dashboard/accounts" className="font-semibold underline">
          Add a {modeLabel(mode)} account on Bank &amp; Accounts
        </Link>{" "}
        first, or choose another payment mode.
      </div>
    );
  }
  return (
    <select required value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="" disabled>
        Choose {modeLabel(mode)} account…
      </option>
      {options.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.kind === "bank" && a.account_number ? ` · A/c ${a.account_number}` : ""}
          {a.is_default ? " (default)" : ""}
        </option>
      ))}
    </select>
  );
}

/** Whether a form's mode/account choice can be saved; returns the problem otherwise. */
export function accountProblem(accounts: FinanceAccount[], mode: PaymentMode, accountId: string): string | null {
  const options = accounts.filter((a) => a.kind === mode && a.is_active);
  if (options.length === 0) return `Add a ${modeLabel(mode)} account on Bank & Accounts before recording ${modeLabel(mode)} payments.`;
  if (!accountId || !options.some((a) => a.id === accountId)) return `Choose the ${modeLabel(mode)} account this money moved through.`;
  return null;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className={cn(
          "bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-h-[90vh] overflow-y-auto",
          wide ? "max-w-3xl" : "max-w-md"
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** From / To date filter with quick presets. */
export function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const preset = (kind: "month" | "lastMonth" | "fy" | "all") => {
    const now = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (kind === "all") return onChange("", "");
    if (kind === "month") return onChange(iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now));
    if (kind === "lastMonth")
      return onChange(
        iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        iso(new Date(now.getFullYear(), now.getMonth(), 0))
      );
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    onChange(iso(new Date(fyStart, 3, 1)), iso(now));
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="From">
        <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className={inputClass} />
      </Field>
      <Field label="To">
        <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className={inputClass} />
      </Field>
      <div className="flex gap-1">
        {(
          [
            ["month", "This month"],
            ["lastMonth", "Last month"],
            ["fy", "This FY"],
            ["all", "All"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => preset(k)} className={cn(secondaryButton, "px-3")}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
