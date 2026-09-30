"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { createErrorNotification } from "@/lib/notifications";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global Application Error Caught:", error);

    const logError = async () => {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected application error occurred.";

      await createErrorNotification(
        "Application Error",
        message
      );
    };

    void logError();
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xl p-8">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mb-6 mx-auto">
          <AlertCircle className="w-8 h-8" />
        </div>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
          Application Error
        </h2>

        <p className="text-gray-600 dark:text-gray-400 mb-8">
          We encountered an unexpected system error. We&apos;ve securely
          logged the issue. Please try refreshing the page or return to the
          login screen.
        </p>

        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <button
            onClick={() => reset()}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors focus:ring-4 focus:ring-indigo-500/20"
          >
            <RefreshCcw className="w-4 h-4" />
            Refresh Page
          </button>

          <Link
            href="/login"
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 font-medium rounded-lg transition-colors focus:ring-4 focus:ring-gray-500/20"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}