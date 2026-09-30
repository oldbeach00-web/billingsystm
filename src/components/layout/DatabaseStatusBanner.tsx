"use client";

import { AlertTriangle } from "lucide-react";
import { isDbConfigured } from "@/lib/db";

interface DatabaseStatusBannerProps {
  error?: string | null;
}

export function DatabaseStatusBanner({ error }: DatabaseStatusBannerProps) {
  const isConfigured = isDbConfigured();
  const isFetchError =
    error?.includes("Failed to fetch") ||
    error?.includes("TypeError") ||
    !isConfigured;

  if (!isFetchError && !error) return null;

  return (
    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm space-y-2 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-900 dark:text-amber-100">
            Database Status
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Database connection is not configured yet.
          </p>
        </div>
      </div>
    </div>
  );
}
