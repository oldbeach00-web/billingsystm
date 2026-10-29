"use client";

import {  useState, useEffect , useCallback } from "react";
import Link from "next/link";
import { db, fetchAllRows } from '@/lib/db';
import type { Customer, Invoice } from "@/types/database";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  Search,
  Loader2,
  AlertCircle,
  X,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Store,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { WALK_IN_NAME, findWalkInCustomerIds } from "@/lib/walkIn";

interface WalkInSummary {
  bills: number;
  total: number;
  paid: number;
  due: number;
}

type WalkInInvoiceRow = Pick<Invoice, "total_amount" | "amount_paid" | "amount_due">;

interface CustomerWithTotals extends Customer {
  customer_type: "retail" | "regular";
  total_purchases: number;
  total_paid: number;
  total_balance: number;
}

export default function CustomersPage() {
  
  const [customers, setCustomers] = useState<CustomerWithTotals[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination & Search
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const pageSize = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // reset to page 1 on new search
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Modal States
  const [walkIn, setWalkIn] = useState<WalkInSummary | null>(null);

  // Totals for the shared walk-in customer record, shown in its own section
  const fetchWalkInSummary = useCallback(async () => {
    try {
      const ids = await findWalkInCustomerIds();
      if (ids.length === 0) {
        setWalkIn({ bills: 0, total: 0, paid: 0, due: 0 });
        return;
      }

      const { data, error: invErr } = await fetchAllRows<WalkInInvoiceRow>(() =>
        db.from("invoices")
          .select("total_amount, amount_paid, amount_due")
          .in("customer_id", ids)
          .not("status", "in", "(draft,cancelled)")
          .order("id")
      );
      if (invErr) throw new Error(invErr.message);

      setWalkIn({
        bills: data.length,
        total: data.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0),
        paid: data.reduce((sum, inv) => sum + Number(inv.amount_paid || 0), 0),
        due: data.reduce((sum, inv) => sum + Number(inv.amount_due || 0), 0),
      });
    } catch {
      // The customer list still works without the walk-in totals
      setWalkIn(null);
    }
  }, []);

  useEffect(() => {
    setTimeout(() => fetchWalkInSummary(), 0);
  }, [fetchWalkInSummary]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    billing_address: "",
    email: "",
    notes: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Archived (soft-deleted) customers are hidden
      let query = db
        .from("customers")
        .select("*", { count: "exact" })
        .eq("is_active", true)
        // The shared walk-in record has its own section above the table
        .not("name", "ilike", WALK_IN_NAME);

      // Strip characters with meaning in PostgREST filter syntax
      const term = debouncedSearch.replace(/[,()*%\\:"]/g, " ").trim();

      if (term) {
        query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,billing_address.ilike.%${term}%`);
      }

      query = query.order("name").range((page - 1) * pageSize, page * pageSize - 1);

      const { data: custData, count, error: custErr } = await query;

      if (custErr) throw new Error(custErr.message);

      setTotalCount(count || 0);

      const customersList = (custData as Customer[]) || [];
      if (customersList.length === 0) {
        setCustomers([]);
        return;
      }

      // Fetch invoices only for the current page of customers to calculate balances
      const customerIds = customersList.map(c => c.id);
      const { data: invData, error: invErr } = await db.from("invoices")
        .select("customer_id, customer_type, total_amount, amount_paid, amount_due, status")
        .in("customer_id", customerIds)
        .not("status", "in", "(draft,cancelled)");

      if (invErr) throw new Error(invErr.message);

      const invs = (invData as Invoice[]) || [];

      // Calculate totals per customer
      const mapped: CustomerWithTotals[] = customersList.map((c) => {
        const custInvs = invs.filter((inv) => inv.customer_id === c.id);
        const customer_type = custInvs.some((inv) => inv.customer_type === "retail") ? "retail" : "regular";
        const total_purchases = custInvs.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
        const total_paid = custInvs.reduce((sum, inv) => sum + Number(inv.amount_paid || 0), 0);
        const total_balance = custInvs.reduce((sum, inv) => sum + Number(inv.amount_due ?? Math.max(0, (inv.total_amount || 0) - (inv.amount_paid || 0))), 0);

        return {
          ...c,
          customer_type,
          total_purchases,
          total_paid,
          total_balance,
        };
      });

      setCustomers(mapped);
    } catch (err: unknown) { setError((err as { message?: string })?.message || "An error occurred while fetching customers.");
    } finally { setIsLoading(false); } }, [page, pageSize, debouncedSearch]);

  useEffect(() => {
    setTimeout(() => fetchCustomers(), 0);
    }, [page, debouncedSearch, fetchCustomers]);

  const handleOpenModal = (customer?: Customer) => {
    setModalError(null);
    if (customer) {
      setEditingCustomer(customer);
      setFormData({
        name: customer.name || "",
        phone: customer.phone || "",
        billing_address: customer.billing_address || "",
        email: customer.email || "",
        notes: customer.notes || "",
      });
    } else {
      setEditingCustomer(null);
      setFormData({
        name: "",
        phone: "",
        billing_address: "",
        email: "",
        notes: "",
      });
    }
    setIsModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setModalError("Customer name is required.");
      return;
    }

    if (!editingCustomer) {
      const phone = formData.phone.trim();
      if (!phone) {
        setModalError("Phone number is required.");
        return;
      }
      if (!/^\d{10}$/.test(phone)) {
        setModalError("Please enter a valid 10-digit phone number.");
        return;
      }
    }

    setIsSaving(true);
    setModalError(null);

    const payload = {
      name: formData.name.trim(),
      phone: formData.phone.trim() || null,
      billing_address: formData.billing_address.trim() || null,
      email: formData.email.trim() || null,
      notes: formData.notes.trim() || null,
      country: "India",
    };

    if (editingCustomer) {
      const { error: updateErr } = await (db.from("customers") as { update: (data: unknown) => { eq: (k: string, v: string) => Promise<{error: {message: string} | null}> }, insert: (data: unknown[]) => Promise<{error: {message: string} | null}>, select: (s: string) => { eq: (k: string, v: string) => { single: () => Promise<{data: unknown, error: {message: string} | null}> } } })
        .update(payload)
        .eq("id", editingCustomer.id);

      if (updateErr) {
        setModalError(updateErr.message);
        setIsSaving(false);
      } else {
        setIsModalOpen(false);
        await fetchCustomers();
      }
    } else {
      const { error: insertErr } = await (db.from("customers") as { update: (data: unknown) => { eq: (k: string, v: string) => Promise<{error: {message: string} | null}> }, insert: (data: unknown[]) => Promise<{error: {message: string} | null}>, select: (s: string) => { eq: (k: string, v: string) => { single: () => Promise<{data: unknown, error: {message: string} | null}> } } }).insert([payload]);

      if (insertErr) {
        setModalError(insertErr.message);
        setIsSaving(false);
      } else {
        setIsModalOpen(false);
        await fetchCustomers();
      }
    }

    setIsSaving(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Archive customer "${name}"? They will be hidden from lists and billing, but their invoices are kept.`)) return;

    // Soft delete: a hard delete would break or orphan their invoices
    const { error: delErr } = await db.from("customers").update({ is_active: false }).eq("id", id);
    if (delErr) {
      alert("Error archiving customer: " + delErr.message);
    } else {
      await fetchCustomers();
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Customer Management</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage customer records, contact info, total purchases, and balances
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Walk-in Customers */}
      {walkIn && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-emerald-200 dark:border-emerald-800 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30">
                <Store className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Walk-in Customers</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Counter sales billed without customer details
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                href="/dashboard/invoices?customers=walk_in"
                className="px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              >
                View walk-in bills
              </Link>
              <Link
                href="/dashboard/invoices/new"
                className="px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
              >
                New bill
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Bills", value: String(walkIn.bills), className: "text-gray-900 dark:text-white" },
              { label: "Total Sales", value: formatCurrency(walkIn.total), className: "text-gray-900 dark:text-white" },
              { label: "Paid", value: formatCurrency(walkIn.paid), className: "text-emerald-600 dark:text-emerald-400" },
              { label: "Due", value: formatCurrency(walkIn.due), className: "text-amber-600 dark:text-amber-400" },
            ].map((stat) => (
              <div key={stat.label} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40">
                <p className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</p>
                <p className={`text-lg font-bold ${stat.className}`}>{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by Customer Name, Phone, or Address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Customers Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <Users className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">No customers found</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {debouncedSearch ? "Try adjusting your search query." : "Add your first customer to track purchases and balances."}
          </p>
          {!debouncedSearch && (
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Customer
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer Name</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Purchases</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Paid</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Balance</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">
                      {c.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {c.customer_type === "retail" ? "Retail / Walk-in" : "Regular Customer"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {c.phone || "_"}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                      {c.billing_address || "_"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-gray-900 dark:text-white">
                      {formatCurrency(c.total_purchases)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(c.total_paid)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-amber-600 dark:text-amber-400">
                      {formatCurrency(c.total_balance)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleOpenModal(c)}
                        className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-3 inline-block"
                        title="Edit Customer"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(c.id, c.name)}
                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 inline-block"
                        title="Archive Customer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 gap-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, totalCount)}</span> of <span className="font-medium">{totalCount}</span> customers
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400 px-2 font-medium">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {editingCustomer ? "Edit Customer" : "Add New Customer"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {modalError}
              </div>
            )}

            <form onSubmit={handleSaveCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Customer Name (required)
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. John Doe / ABC Traders"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone Number (required)
                  </label>
                  <input
                    type="text"
                    required={!editingCustomer}
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. +91 98765 43210"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Billing Address
                </label>
                <textarea
                  rows={2}
                  value={formData.billing_address}
                  onChange={(e) => setFormData({ ...formData, billing_address: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Complete billing address"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email (optional)
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="customer@example.com"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !formData.name.trim() || (!editingCustomer && !/^\d{10}$/.test(formData.phone.trim()))}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

























