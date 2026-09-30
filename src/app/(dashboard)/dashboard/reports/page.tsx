"use client";

import { useState, useEffect, useCallback } from "react";
import { db } from "@/lib/db";
import type { Invoice, InvoiceItem, Product, Customer } from "@/types/database";
import {
  BarChart3,
  AlertTriangle,
  Package,
  Users,
  Calendar,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

type ReportTab = "products" | "customers" | "stock" | "low_stock";

type InvoiceItemWithProductRow = InvoiceItem & {
  product?: Product | Product[] | null;
};

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>("products");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Raw data
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<
    (InvoiceItem & { product?: Product })[]
  >([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Date Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [
        { data: invs, error: iErr },
        { data: items, error: itErr },
        { data: prods, error: pErr },
        { data: custs, error: cErr },
      ] = await Promise.all([
        db
          .from("invoices")
          .select("*")
          .neq("status", "cancelled")
          .order("issue_date", { ascending: false }),
        db.from("invoice_items").select("*, product:products(*)"),
        db.from("products").select("*").order("name"),
        db.from("customers").select("*").order("name"),
      ]);

      if (iErr) throw new Error(iErr.message);
      if (itErr) throw new Error(itErr.message);
      if (pErr) throw new Error(pErr.message);
      if (cErr) throw new Error(cErr.message);

      setInvoices(invs || []);

      const rows = (items ?? []) as unknown as InvoiceItemWithProductRow[];

      const mappedItems: (InvoiceItem & { product?: Product })[] = rows.map(
        (it) => ({
          ...it,
          product: Array.isArray(it.product)
            ? it.product[0]
            : it.product ?? undefined,
        })
      );

      setInvoiceItems(mappedItems);
      setProducts(prods || []);
      setCustomers(custs || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error loading reports data."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setTimeout(() => fetchData(), 0);
  }, [fetchData]);

  // Filter invoices by date range
  const filteredInvoices = invoices.filter((inv) => {
    let match = true;

    if (startDate) {
      match = match && inv.issue_date >= startDate;
    }

    if (endDate) {
      match = match && inv.issue_date <= endDate;
    }

    return match;
  });

  const filteredInvoiceIds = new Set(filteredInvoices.map((inv) => inv.id));

  const filteredInvoiceItems = invoiceItems.filter((item) =>
    filteredInvoiceIds.has(item.invoice_id)
  );

  // Date helper thresholds
  const todayStr = new Date().toISOString().split("T")[0];
  const now = new Date();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(now.getDate() - 7);

  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

  const startOfMonthStr = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  )
    .toISOString()
    .split("T")[0];

  const startOfYearStr = new Date(
    now.getFullYear(),
    0,
    1
  )
    .toISOString()
    .split("T")[0];

  // Calculated Sales Aggregates
  const dailySales = invoices
    .filter((inv) => inv.issue_date === todayStr)
    .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

  const weeklySales = invoices
    .filter((inv) => inv.issue_date >= sevenDaysAgoStr)
    .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

  const monthlySales = invoices
    .filter((inv) => inv.issue_date >= startOfMonthStr)
    .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

  const yearlySales = invoices
    .filter((inv) => inv.issue_date >= startOfYearStr)
    .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

  // Filtered Totals
  const totalSales = filteredInvoices.reduce(
    (sum, inv) => sum + Number(inv.total_amount || 0),
    0
  );

  const totalPaid = filteredInvoices.reduce(
    (sum, inv) => sum + Number(inv.amount_paid || 0),
    0
  );

  const totalBalance = filteredInvoices.reduce(
    (sum, inv) =>
      sum +
      Number(
        inv.amount_due ??
          Math.max(0, inv.total_amount - inv.amount_paid)
      ),
    0
  );

  const invoiceCount = filteredInvoices.length;

  // Product Sales Summary Aggregation
  const productSalesMap = new Map<
    string,
    {
      product_id: string;
      name: string;
      sku: string;
      qty_sold: number;
      revenue: number;
    }
  >();

  filteredInvoiceItems.forEach((item) => {
    const key = item.product_id || item.description;

    const existing = productSalesMap.get(key) || {
      product_id: key,
      name: item.product?.name || item.description,
      sku: item.product?.sku || "Custom",
      qty_sold: 0,
      revenue: 0,
    };

    existing.qty_sold += Number(item.quantity || 0);
    existing.revenue += Number(item.total_amount || 0);

    productSalesMap.set(key, existing);
  });

  const productSalesList = Array.from(productSalesMap.values()).sort(
    (a, b) => b.revenue - a.revenue
  );

  // Customer Sales Summary Aggregation
  const customerSalesMap = new Map<
    string,
    {
      customer_id: string;
      name: string;
      orders: number;
      total_spent: number;
      balance: number;
    }
  >();

  customers.forEach((c) => {
    const custInvs = filteredInvoices.filter(
      (inv) => inv.customer_id === c.id
    );

    const spent = custInvs.reduce(
      (sum, inv) => sum + Number(inv.total_amount || 0),
      0
    );

    const bal = custInvs.reduce(
      (sum, inv) =>
        sum +
        Number(
          inv.amount_due ??
            Math.max(0, inv.total_amount - inv.amount_paid)
        ),
      0
    );

    if (custInvs.length > 0 || spent > 0 || bal > 0) {
      customerSalesMap.set(c.id, {
        customer_id: c.id,
        name: c.name,
        orders: custInvs.length,
        total_spent: spent,
        balance: bal,
      });
    }
  });

  const customerSalesList = Array.from(customerSalesMap.values()).sort(
    (a, b) => b.total_spent - a.total_spent
  );

  // Low Stock Items
  const lowStockProducts = products.filter(
    (p) =>
      Number(p.stock_quantity) <= Number(p.min_stock_level)
  );

  return (
    <div className="space-y-6">
      {/* Header & Date Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Business Reports &amp; Analytics
          </h2>

          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track daily, weekly, monthly, and yearly sales performance and
            stock reports
          </p>
        </div>

        {/* Date Filter */}
        <div className="bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-3 text-xs">
          <span className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-indigo-600" />
            Filter Date Range:
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">From:</span>

            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">To:</span>

            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
          </div>

          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
              title="Reset date filter"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* STAGE 10 SALES AGGREGATES CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* Daily Sales */}
        <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Today&apos;s Sales
          </p>

          <p className="text-base font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
            {formatCurrency(dailySales)}
          </p>
        </div>

        {/* Weekly Sales */}
        <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            7-Day Sales
          </p>

          <p className="text-base font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
            {formatCurrency(weeklySales)}
          </p>
        </div>

        {/* Monthly Sales */}
        <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            This Month
          </p>

          <p className="text-base font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
            {formatCurrency(monthlySales)}
          </p>
        </div>

        {/* Yearly Sales */}
        <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            This Year
          </p>

          <p className="text-base font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
            {formatCurrency(yearlySales)}
          </p>
        </div>

        {/* Total Sales */}
        <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Total Sales
          </p>

          <p className="text-base font-extrabold text-gray-900 dark:text-white mt-1">
            {formatCurrency(totalSales)}
          </p>
        </div>

        {/* Total Paid */}
        <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Total Paid
          </p>

          <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
            {formatCurrency(totalPaid)}
          </p>
        </div>

        {/* Total Balance */}
        <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Total Balance
          </p>

          <p className="text-base font-extrabold text-amber-600 dark:text-amber-400 mt-1">
            {formatCurrency(totalBalance)}
          </p>
        </div>

        {/* Invoice Count */}
        <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Total Invoices
          </p>

          <p className="text-base font-extrabold text-gray-900 dark:text-white mt-1">
            {invoiceCount}
          </p>
        </div>
      </div>

      {/* Report Section Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 overflow-x-auto">
          <button
            onClick={() => setActiveTab("products")}
            className={cn(
              "px-5 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2",
              activeTab === "products"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-800"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            )}
          >
            <Package className="w-4 h-4" />
            Product Sales Report ({productSalesList.length})
          </button>

          <button
            onClick={() => setActiveTab("customers")}
            className={cn(
              "px-5 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2",
              activeTab === "customers"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-800"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            )}
          >
            <Users className="w-4 h-4" />
            Customer Sales Report ({customerSalesList.length})
          </button>

          <button
            onClick={() => setActiveTab("stock")}
            className={cn(
              "px-5 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2",
              activeTab === "stock"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-800"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            )}
          >
            <BarChart3 className="w-4 h-4" />
            Stock Report ({products.length})
          </button>

          <button
            onClick={() => setActiveTab("low_stock")}
            className={cn(
              "px-5 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2",
              activeTab === "low_stock"
                ? "border-red-600 text-red-600 dark:text-red-400 bg-white dark:bg-gray-800"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            )}
          >
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Low Stock Alerts ({lowStockProducts.length})
          </button>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : activeTab === "products" ? (
            /* Product Sales Table */
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Product Name</th>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-right">Qty Sold</th>
                    <th className="px-4 py-3 text-right">
                      Revenue Generated
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  {productSalesList.map((item, i) => (
                    <tr
                      key={item.product_id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>

                      <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                        {item.name}
                      </td>

                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        {item.sku}
                      </td>

                      <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                        {item.qty_sold}
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                        {formatCurrency(item.revenue)}
                      </td>
                    </tr>
                  ))}

                  {productSalesList.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                      >
                        No product sales recorded in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : activeTab === "customers" ? (
            /* Customer Sales Table */
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Customer Name</th>
                    <th className="px-4 py-3 text-right">Total Invoices</th>
                    <th className="px-4 py-3 text-right">Total Spent</th>
                    <th className="px-4 py-3 text-right">
                      Outstanding Balance
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  {customerSalesList.map((cust, i) => (
                    <tr
                      key={cust.customer_id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>

                      <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                        {cust.name}
                      </td>

                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                        {cust.orders}
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">
                        {formatCurrency(cust.total_spent)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-amber-600 dark:text-amber-400">
                        {formatCurrency(cust.balance)}
                      </td>
                    </tr>
                  ))}

                  {customerSalesList.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                      >
                        No customer transactions in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : activeTab === "stock" ? (
            /* Stock Inventory Report */
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Product Name</th>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-right">Selling Price</th>
                    <th className="px-4 py-3 text-right">Current Stock</th>
                    <th className="px-4 py-3 text-right">
                      Total Stock Value
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  {products.map((p, i) => {
                    const stockVal =
                      Number(p.stock_quantity || 0) *
                      Number(p.unit_price || 0);

                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <td className="px-4 py-3 text-gray-400">{i + 1}</td>

                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                          {p.name}
                        </td>

                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                          {p.sku}
                        </td>

                        <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">
                          {formatCurrency(p.unit_price)}
                        </td>

                        <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">
                          {p.stock_quantity} {p.unit_of_measure}
                        </td>

                        <td className="px-4 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                          {formatCurrency(stockVal)}
                        </td>
                      </tr>
                    );
                  })}

                  {products.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                      >
                        No products found in inventory.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Low Stock Alerts Report */
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-red-50 dark:bg-red-900/20 text-xs font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Product Name</th>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-right">Current Stock</th>
                    <th className="px-4 py-3 text-right">
                      Min Stock Level
                    </th>
                    <th className="px-4 py-3 text-right">Stock Deficit</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  {lowStockProducts.map((p, i) => {
                    const deficit =
                      Number(p.min_stock_level) -
                      Number(p.stock_quantity);

                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-red-50/50 dark:hover:bg-red-900/10"
                      >
                        <td className="px-4 py-3 text-gray-400">{i + 1}</td>

                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                          {p.name}
                        </td>

                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                          {p.sku}
                        </td>

                        <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">
                          {p.stock_quantity} {p.unit_of_measure}
                        </td>

                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                          {p.min_stock_level} {p.unit_of_measure}
                        </td>

                        <td className="px-4 py-3 text-right font-extrabold text-red-700 dark:text-red-400">
                          -{deficit > 0 ? deficit : 0} {p.unit_of_measure}
                        </td>
                      </tr>
                    );
                  })}

                  {lowStockProducts.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-emerald-600 dark:text-emerald-400 font-medium"
                      >
                        ✓ All stock levels are healthy! No products are below
                        minimum stock level.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}