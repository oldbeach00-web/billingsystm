import type { Metadata } from "next";
import { FileText } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign In",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 px-4 py-12">
      {/* Brand */}
      <div className="flex flex-col items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            BillManager
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Billing &amp; Inventory Management System
          </p>
        </div>
      </div>

      {/* Auth content */}
      <div className="w-full max-w-md">{children}</div>

      {/* Footer */}
    </div>
  );
}
