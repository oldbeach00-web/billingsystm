"use client";

import { AlertTriangle } from "lucide-react";
import { isDbConfigured } from "@/lib/db";

interface DatabaseStatusBannerProps {
  /** A page's load error. Omit in the layout, which reports configuration. */
  error?: string | null;
}

/**
 * Rendered once in the dashboard layout (no `error`) to warn on every page
 * when the database isn't configured, and by individual pages to show their
 * own load errors.
 */
export function DatabaseStatusBanner({ error }: DatabaseStatusBannerProps) {
  const isConfigured = isDbConfigured();
  const isLayoutBanner = error === undefined;

  let message: string | null = null;

  if (isLayoutBanner) {
    if (!isConfigured) {
      message =
        "Database connection is not configured. Data shown is empty and nothing can be saved.";
    }
  } else if (error && isConfigured) {
    // When unconfigured, the layout banner already explains the problem
    message = error.includes("Failed to fetch")
      ? "Could not reach the database. Check your internet connection."
      : `Could not load data: ${error}`;
  }

  if (!message) return null;

  return (
    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm space-y-2 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-900 dark:text-amber-100">
            Database Status
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}
