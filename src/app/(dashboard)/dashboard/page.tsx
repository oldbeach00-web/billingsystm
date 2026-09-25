import type { Metadata } from "next";
import { db } from '@/lib/db';
import {
  FileText,
  Users,
  Package,
  CreditCard,
  TrendingUp,
  IndianRupee,
  Box,
  AlertCircle,
  ArrowRight
} from "lucide-react";
import Link from "next/link";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { Invoice, Product, Customer } from "@/types/database";
import { DatabaseStatusBanner } from "@/components/layout/DatabaseStatusBanner";

export const metadata: Metadata = {
  title: "Dashboard",
};

const quickLinks = [
  {
    label: "Create Invoice",
    description: "Generate a new invoice",
    href: "/dashboard/invoices/new",
    icon: FileText,
  },
  {
    label: "Add Customer",
    description: "Register a new customer",
    href: "/dashboard/customers/new",
    icon: Users,
  },
  {
    label: "Add Product",
    description: "Add a new product",
    href: "/dashboard/products/new",
    icon: Package,
  },
  {
    label: "Record Payment",
    description: "Log an invoice payment",
    href: "/dashboard/payments/new",
    icon: CreditCard,
  },
];

export default async function DashboardPage() {
  

  let invoices: Invoice[] | null = null;
  let totalCustomers: number | null = 0;
  let products: Product[] | null = null;
  let recentInvoices: any[] | null = null;
  let fetchError: string | null = null;

  try {
    const results = await Promise.all([
      db.from("invoices").select("id, status, total_amount, amount_due, created_at"),
      db.from("customers").select("id", { count: "exact", head: true }),
      db.from("products").select("id, name, sku, stock_quantity, min_stock_level, unit_of_measure"),
      db
        .from("invoices")
        .select("id, invoice_number, total_amount, status, created_at, customer:customers(name)")
        .order("created_at", { ascending: false })
        .limit(5)
    ]);
    invoices = (results[0].data as Invoice[]) || [];
    totalCustomers = results[1].count;
    products = (results[2].data as Product[]) || [];
    recentInvoices = results[3].data || [];
  } catch (err: any) {
    fetchError = err?.message || "Failed to fetch database data";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  let totalSales = 0;
  let todaysSales = 0;
  let pendingBalance = 0;
  const totalInvoices = invoices?.length || 0;

  invoices?.forEach((inv: Invoice) => {
    if (inv.status !== 'cancelled' && inv.status !== 'draft') {
      totalSales += Number(inv.total_amount);
      if (new Date(inv.created_at) >= new Date(startOfToday)) {
        todaysSales += Number(inv.total_amount);
      }
    }
    pendingBalance += Number(inv.amount_due);
  });

  const totalProducts = products?.length || 0;
  let currentStock = 0;
  let lowStockCount = 0;
  const lowStockProducts: Product[] = [];

  products?.forEach((prod: Product) => {
    const stock = Number(prod.stock_quantity);
    const minStock = Number(prod.min_stock_level);
    currentStock += stock;
    if (stock <= minStock) {
      lowStockCount++;
      lowStockProducts.push(prod);
    }
  });

  // Sort low stock by stock quantity (ascending) and take top 5
  lowStockProducts.sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity));
  const recentLowStock = lowStockProducts.slice(0, 5);

  const stats = [
    {
      label: "Today's Sales",
      value: formatCurrency(todaysSales),
      icon: TrendingUp,
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
      iconColor: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Total Sales",
      value: formatCurrency(totalSales),
      icon: IndianRupee,
      iconBg: "bg-indigo-100 dark:bg-indigo-900/30",
      iconColor: "text-indigo-600 dark:text-indigo-400",
    },
    {
      label: "Total Invoices",
      value: totalInvoices.toString(),
      icon: FileText,
      iconBg: "bg-blue-100 dark:bg-blue-900/30",
      iconColor: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "Pending Balance",
      value: formatCurrency(pendingBalance),
      icon: CreditCard,
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
      iconColor: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Total Customers",
      value: (totalCustomers || 0).toString(),
      icon: Users,
      iconBg: "bg-violet-100 dark:bg-violet-900/30",
      iconColor: "text-violet-600 dark:text-violet-400",
    },
    {
      label: "Total Products",
      value: totalProducts.toString(),
      icon: Package,
      iconBg: "bg-fuchsia-100 dark:bg-fuchsia-900/30",
      iconColor: "text-fuchsia-600 dark:text-fuchsia-400",
    },
    {
      label: "Current Stock",
      value: currentStock.toString(),
      icon: Box,
      iconBg: "bg-cyan-100 dark:bg-cyan-900/30",
      iconColor: "text-cyan-600 dark:text-cyan-400",
    },
    {
      label: "Low Stock Items",
      value: lowStockCount.toString(),
      icon: AlertCircle,
      iconBg: "bg-rose-100 dark:bg-rose-900/30",
      iconColor: "text-rose-600 dark:text-rose-400",
    },
  ];

  return (
    <div className="space-y-6">
      <DatabaseStatusBanner error={fetchError} />
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Overview of your billing and inventory status
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`w-10 h-10 rounded-lg ${stat.iconBg} flex items-center justify-center`}
                >
                  <Icon className={`w-5 h-5 ${stat.iconColor}`} />
                </div>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {stat.value}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {stat.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
          Quick Actions
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="group bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
                    <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-600 ml-auto group-hover:text-indigo-400 transition-colors" />
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {link.label}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {link.description}
                </p>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Recent Invoices
            </h3>
            <Link
              href="/dashboard/invoices"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              View all
            </Link>
          </div>
          {recentInvoices && recentInvoices.length > 0 ? (
            <div className="space-y-4">
              {recentInvoices.map((inv: Invoice & { customer: Customer }) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {inv.invoice_number}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {inv.customer?.name || "Unknown"} • {formatDate(inv.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {formatCurrency(Number(inv.total_amount))}
                    </p>
                    <span
                      className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded-full mt-1 inline-block",
                        inv.status === "paid" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                        inv.status === "overdue" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                        inv.status === "draft" && "bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-300",
                        !["paid", "overdue", "draft"].includes(inv.status) && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      )}
                    >
                      {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No invoices yet.</p>
            </div>
          )}
        </div>

        {/* Low Stock Items */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Low Stock Alerts
            </h3>
            <Link
              href="/dashboard/products"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Manage stock
            </Link>
          </div>
          {recentLowStock && recentLowStock.length > 0 ? (
            <div className="space-y-4">
              {recentLowStock.map((prod: Product) => (
                <div
                  key={prod.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {prod.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      SKU: {prod.sku}
                    </p>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      <p className="text-sm font-bold text-red-600 dark:text-red-400">
                        {prod.stock_quantity} {prod.unit_of_measure}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Min: {prod.min_stock_level}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Box className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">All products are adequately stocked.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
