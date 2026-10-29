"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { db, fetchAllRows } from "@/lib/db";
import type { Customer, Product } from "@/types/database";
import {
  Search,
  Plus,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  Eye,
  UserPlus,
  CheckCircle,
  Store,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  clampNumber,
  computeInvoiceTotals,
  computeLineAmounts,
  computePaymentStatus,
  localDateString,
  round2,
  toPaise,
} from "@/lib/billing";
import { BillPreview } from "@/components/invoices/BillPreview";
import {
  WALK_IN_NAME,
  getOrCreateWalkInCustomerId,
  isWalkInCustomer,
} from "@/lib/walkIn";

// ─── Draft Persistence ────────────────────────────────────────────────────────
const DRAFT_KEY = "new_invoice_draft_v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BillLineItem {
  id: string;
  product_id: string | null;
  product?: Product;
  description: string;
  quantity: number;
  unit_price: number;
  discount_percentage: number;
  discount_amount: number;
  total_amount: number;
}

export interface BillCustomer {
  id: string | null;
  name: string;
  phone: string;
  billing_address: string;
  /** Bill goes to the shared walk-in customer record (no details taken) */
  is_walk_in?: boolean;
}

interface CustomerInsertData {
  id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Keeps every numeric input inside its valid range (no negative quantities,
// or prices; percentages within 0–100).
function sanitizeLine<T extends BillLineItem | Omit<BillLineItem, "discount_amount" | "total_amount">>(
  line: T
): T {
  return {
    ...line,
    quantity: clampNumber(Number(line.quantity), 0),
    unit_price: clampNumber(Number(line.unit_price), 0),
    discount_percentage: clampNumber(Number(line.discount_percentage), 0, 100),
  };
}

// Line amounts before the overall discount (the overall discount is applied
// in pricedLines below).
function computeLine(
  line: Omit<BillLineItem, "discount_amount" | "total_amount">
): BillLineItem {
  const clean = sanitizeLine(line);
  const amounts = computeLineAmounts(clean);

  return {
    ...clean,
    discount_amount: amounts.discount_amount,
    total_amount: amounts.total_amount,
  };
}

function newLineItem(product?: Product): BillLineItem {
  const draft = {
    id: crypto.randomUUID(),
    product_id: product?.id ?? null,
    product,
    description: product?.name ?? "",
    quantity: 1,
    unit_price: product?.unit_price ?? 0,
    discount_percentage: 0,
    discount_amount: 0,
    total_amount: 0,
  };

  return computeLine(draft);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NewInvoicePage() {
  const router = useRouter();

  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Draft persistence
  const [draftRestored, setDraftRestored] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bill state
  const [issueDate, setIssueDate] = useState(() => localDateString());
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return localDateString(d);
  });
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<BillLineItem[]>([newLineItem()]);
  const [globalDiscount, setGlobalDiscount] = useState(0);

  // Stage 6 Payment state
  const [paidAmountInput, setPaidAmountInput] = useState("0");

  // Customer state
  const [customer, setCustomer] = useState<BillCustomer>({
    id: null,
    name: "",
    phone: "",
    billing_address: "",
  });
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const customerRef = useRef<HTMLDivElement>(null);

  // Product search
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const productRef = useRef<HTMLDivElement>(null);

  // Preview modal
  const [showPreview, setShowPreview] = useState(false);

  // ─── Load data + restore draft ────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      const [{ data: prods }, { data: custs }] = await Promise.all([
        fetchAllRows<Product>(() =>
          db.from("products").select("*").eq("is_active", true).order("name")
        ),
        fetchAllRows<Customer>(() =>
          db.from("customers").select("*").eq("is_active", true).order("name")
        ),
      ]);

      if (cancelled) return;

      const loadedProducts = (prods || []) as Product[];
      const loadedCustomers = (custs || []) as Customer[];

      setProducts(loadedProducts);
      setCustomers(loadedCustomers);

      // ── Restore draft from localStorage ──────────────────────────────────
      try {
        const raw = localStorage.getItem(DRAFT_KEY);

        if (raw) {
          const saved = JSON.parse(raw) as {
            customer: BillCustomer;
            customerSearch: string;
            lines: BillLineItem[];
            globalDiscount: number;
            issueDate: string;
            dueDate: string;
            notes: string;
            paidAmountInput: string;
          };

          // Re-link product objects from freshly loaded products
          const relinkedLines = saved.lines.map((l) => {
            const freshProduct = l.product_id
              ? loadedProducts.find((p) => p.id === l.product_id)
              : undefined;

            return computeLine(
              freshProduct ? { ...l, product: freshProduct } : l
            );
          });

          setCustomer(saved.customer);
          setCustomerSearch(
            saved.customerSearch || saved.customer.name
          );
          setLines(
            relinkedLines.length > 0
              ? relinkedLines
              : [newLineItem()]
          );
          setGlobalDiscount(
            clampNumber(Number(saved.globalDiscount ?? 0), 0, 100)
          );
          setIssueDate(saved.issueDate);
          setDueDate(saved.dueDate);
          setNotes(saved.notes ?? "");
          setPaidAmountInput(saved.paidAmountInput ?? "0");
          setDraftRestored(true);
        }
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }

      setIsLoading(false);
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Auto-save draft to localStorage ─────────────────────────────────────

  useEffect(() => {
    if (isLoading) return;

    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
    }

    draftTimerRef.current = setTimeout(() => {
      const draft = {
        customer,
        customerSearch,
        lines,
        globalDiscount,
        issueDate,
        dueDate,
        notes,
        paidAmountInput,
      };

      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // Storage quota exceeded — silently ignore
      }
    }, 600);

    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
      }
    };
  }, [
    customer,
    customerSearch,
    lines,
    globalDiscount,
    issueDate,
    dueDate,
    notes,
    paidAmountInput,
    isLoading,
  ]);

  // ─── Clear draft helper ──────────────────────────────────────────────────

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);

    setCustomer({
      id: null,
      name: "",
      phone: "",
      billing_address: "",
    });

    setCustomerSearch("");
    setLines([newLineItem()]);
    setGlobalDiscount(0);
    setIssueDate(localDateString());

    const d = new Date();
    d.setDate(d.getDate() + 30);

    setDueDate(localDateString(d));
    setNotes("");
    setPaidAmountInput("0");
    setDraftRestored(false);
    setError(null);
  };

  // ─── Close dropdowns on outside click ────────────────────────────────────

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        customerRef.current &&
        !customerRef.current.contains(e.target as Node)
      ) {
        setShowCustomerDropdown(false);
      }

      if (
        productRef.current &&
        !productRef.current.contains(e.target as Node)
      ) {
        setShowProductDropdown(false);
      }
    }

    document.addEventListener("mousedown", handleClick);

    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, []);

  // ─── Computed totals & Stage 6 Payment Logic ─────────────────────────────

  // The overall discount is spread across lines. Amounts are rounded to paise
  // per line; the server recomputes them identically in create_invoice().
  const pricedLines: BillLineItem[] = lines.map((l) => {
    const amounts = computeLineAmounts(l, globalDiscount);
    return {
      ...l,
      total_amount: amounts.total_amount,
    };
  });

  const totals = computeInvoiceTotals(
    lines
      .filter((l) => l.description.trim())
      .map((l) => computeLineAmounts(l, globalDiscount))
  );

  const subtotal = totals.subtotal;
  const globalDiscountAmt = totals.discount_amount;
  const grandTotal = totals.total_amount;

  const parsedPaid = parseFloat(paidAmountInput);
  const isPaidNegative = Number.isFinite(parsedPaid) && parsedPaid < 0;
  const paidAmount = round2(clampNumber(parsedPaid, 0));

  const isPaidExceedingTotal = toPaise(paidAmount) > toPaise(grandTotal);

  const balanceAmount = round2(Math.max(0, grandTotal - paidAmount));

  const computedStatus = computePaymentStatus(grandTotal, paidAmount);

  // ─── Customer handlers ──────────────────────────────────────────────────

  const filteredCustomers = customers.filter(
    (c) =>
      !isWalkInCustomer(c) &&
      (c.name
        .toLowerCase()
        .includes(customerSearch.toLowerCase()) ||
        (c.phone || "").includes(customerSearch))
  );

  const selectExistingCustomer = (c: Customer) => {
    setCustomer({
      id: c.id,
      name: c.name,
      phone: c.phone || "",
      billing_address: c.billing_address || "",
    });

    setCustomerSearch(c.name);
    setShowCustomerDropdown(false);
    setShowNewCustomerForm(false);
  };

  const selectWalkInCustomer = () => {
    setCustomer({
      id: null,
      name: WALK_IN_NAME,
      phone: "",
      billing_address: "",
      is_walk_in: true,
    });

    setCustomerSearch("");
    setShowCustomerDropdown(false);
    setShowNewCustomerForm(false);
  };

  const clearCustomer = () => {
    setCustomer({
      id: null,
      name: "",
      phone: "",
      billing_address: "",
    });

    setCustomerSearch("");
    setShowNewCustomerForm(false);
  };

  // ─── Line item handlers ─────────────────────────────────────────────────

  const addProduct = (product: Product) => {
    const existing = lines.findIndex(
      (l) => l.product_id === product.id
    );

    if (existing >= 0) {
      updateLine(
        lines[existing].id,
        "quantity",
        lines[existing].quantity + 1
      );
    } else {
      setLines((prev) => [
        ...prev,
        newLineItem(product),
      ]);
    }

    setProductSearch("");
    setShowProductDropdown(false);
  };

  const addEmptyLine = () =>
    setLines((prev) => [
      ...prev,
      newLineItem(),
    ]);

  const removeLine = (id: string) => {
    setLines((prev) =>
      prev.filter((l) => l.id !== id)
    );
  };

  const updateLine = useCallback(
    (
      id: string,
      field: keyof BillLineItem,
      value: number | string
    ) => {
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;

          const updated = {
            ...l,
            [field]: value,
          };

          return computeLine(updated);
        })
      );
    },
    []
  );

  const searchLower =
    productSearch.trim().toLowerCase();

  const filteredProducts =
    searchLower.length >= 2
      ? products.filter(
          (p) =>
            (p.name || "")
              .toLowerCase()
              .includes(searchLower) ||
            (p.sku || "")
              .toLowerCase()
              .includes(searchLower)
        )
      : [];

  // ─── STAGE 7: CONFIRM INVOICE & STOCK MANAGEMENT ─────────────────────────

  const handleSave = async (
    overrideStatus?: "draft"
  ) => {
    if (isSaving) return;

    if (!customer.name.trim()) {
      setError(
        "Please add a customer before confirming."
      );
      return;
    }

    const validLines = lines.filter(
      (l) => l.description.trim()
    );

    if (validLines.length === 0) {
      setError(
        "Please add at least one valid item to the bill."
      );
      return;
    }

    const hasInvalidLine = validLines.some(
      (l) =>
        !(Number(l.quantity) > 0) ||
        !(Number(l.unit_price) >= 0) ||
        !(l.discount_percentage >= 0 && l.discount_percentage <= 100)
    );

    if (hasInvalidLine) {
      setError(
        "Quantity must be greater than 0, prices cannot be negative, and discount must be between 0 and 100%."
      );
      return;
    }

    if (!(globalDiscount >= 0 && globalDiscount <= 100)) {
      setError("Overall discount must be between 0 and 100%.");
      return;
    }

    if (isPaidNegative) {
      setError("Paid amount cannot be negative.");
      return;
    }

    const isDraft = overrideStatus === "draft";

    if (isDraft && paidAmount > 0) {
      setError(
        "A draft cannot include a payment. Set Paid Amount to 0 or confirm the invoice."
      );
      return;
    }

    if (grandTotal < 0) {
      setError("Grand Total cannot be negative.");
      return;
    }

    if (isPaidExceedingTotal) {
      setError(
        `Paid Amount (${formatCurrency(
          paidAmount
        )}) cannot exceed Total Amount (${formatCurrency(
          grandTotal
        )}).`
      );
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const {
        data: { user },
      } = await db.auth.getUser();

      if (!user) {
        throw new Error(
          "Your database session has expired. Please log out and log in again."
        );
      }

      // ── 3. CREATE / GET CUSTOMER ────────────────────────────────────────

      let customerId = customer.id;

      if (
        !customerId &&
        (customer.is_walk_in || isWalkInCustomer(customer))
      ) {
        customerId = await getOrCreateWalkInCustomerId();
      } else if (!customerId && customer.name.trim()) {
        const {
          data: rawNewCust,
          error: custErr,
        } = await db
          .from("customers")
          .insert([
            {
              name: customer.name,
              phone: customer.phone || null,
              billing_address:
                customer.billing_address || null,
              country: "India",
            },
          ])
          .select()
          .single();

        const newCust =
          rawNewCust as CustomerInsertData | null;

        if (custErr) {
          throw new Error(
            "Error creating customer: " +
              custErr.message
          );
        }

        if (!newCust?.id) {
          throw new Error(
            "Customer record was not created."
          );
        }

        customerId = newCust.id;

        // Remember the new customer so a retry after a failed save doesn't
        // create a duplicate customer record
        const createdId = newCust.id;
        setCustomer((c) => ({ ...c, id: createdId }));
      }

      if (!customerId) {
        throw new Error(
          "Customer record missing."
        );
      }

      // ── 4. CREATE INVOICE ATOMICALLY ────────────────────────────────────
      // create_invoice() recomputes all amounts, checks and deducts stock
      // under row locks, assigns the next sequential invoice number and
      // records the initial payment — all in one transaction. There is no
      // client-side fallback: a partial save is worse than a failed one.

      const itemsPayload = validLines.map((l) => ({
        product_id: l.product_id || null,
        description: l.description.trim(),
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_percentage: l.discount_percentage,
      }));

      const { data: rpcRes, error: rpcErr } = await db.rpc(
        "create_invoice",
        {
          p_customer_id: customerId,
          p_is_draft: isDraft,
          p_issue_date: issueDate,
          p_due_date: dueDate,
          p_overall_discount_pct: globalDiscount,
          p_amount_paid: isDraft ? 0 : paidAmount,
          p_payment_method: "cash",
          p_notes: notes || null,
          p_items: itemsPayload,
        }
      );

      if (rpcErr) {
        const rpcError = rpcErr as { code?: string; message?: string };
        throw new Error(
          rpcError.code === "PGRST202"
            ? "The database is missing the create_invoice function. Apply the migration in supabase/migrations first."
            : rpcError.message || "Error creating invoice."
        );
      }

      const created = rpcRes as {
        invoice_number?: string;
      } | null;

      if (!created?.invoice_number) {
        throw new Error("Invoice was not created.");
      }

      localStorage.removeItem(DRAFT_KEY);

      setSuccessMessage(
        `Invoice #${created.invoice_number} ${
          isDraft ? "saved as draft" : "confirmed & created successfully"
        }!`
      );

      setTimeout(() => {
        router.push("/dashboard/invoices");
        router.refresh();
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred while saving the invoice."
      );

      setIsSaving(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              New Invoice
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Invoice number is assigned when saved
            </p>
          </div>

          <div className="flex gap-3">
            {draftRestored && (
              <button
                onClick={clearDraft}
                className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 text-sm font-medium rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
              >
                <X className="w-4 h-4" />
                Clear Draft
              </button>
            )}

            <button
              onClick={() => {
                if (
                  !customer.name.trim() ||
                  lines.every(
                    (l) => !l.description.trim()
                  )
                ) {
                  setError(
                    "Add a customer and at least one item to preview."
                  );
                  return;
                }

                if (isPaidExceedingTotal) {
                  setError(
                    `Paid Amount (${formatCurrency(
                      paidAmount
                    )}) cannot exceed Total Amount (${formatCurrency(
                      grandTotal
                    )}).`
                  );
                  return;
                }

                setError(null);
                setShowPreview(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>

            <button
              onClick={() =>
                handleSave("draft")
              }
              disabled={
                isSaving ||
                isPaidExceedingTotal
              }
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              Save Draft
            </button>

            <button
              onClick={() => handleSave()}
              disabled={
                isSaving ||
                isPaidExceedingTotal
              }
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Confirm Invoice
            </button>
          </div>
        </div>

        {draftRestored && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 rounded-lg flex items-center justify-between text-sm">
            <span>
              📋 Draft restored — your previous invoice data has been loaded.
            </span>

            <button
              onClick={clearDraft}
              className="ml-4 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-medium underline"
            >
              Clear Draft
            </button>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {successMessage && (
          <div className="p-4 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg flex items-center gap-2 font-medium">
            <CheckCircle className="w-5 h-5 flex-shrink-0 text-emerald-600" />
            {successMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Section */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">
                Customer
              </h3>

              {customer.is_walk_in ? (
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {WALK_IN_NAME}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Counter sale, no customer details needed
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={clearCustomer}
                    className="text-gray-400 hover:text-red-500"
                    title="Change customer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : customer.id ||
              showNewCustomerForm ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {showNewCustomerForm
                        ? "New Customer"
                        : customer.name}
                    </span>

                    <button
                      onClick={clearCustomer}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Name *
                      </label>

                      <input
                        value={customer.name}
                        onChange={(e) =>
                          setCustomer((c) => ({
                            ...c,
                            name: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Customer name"
                        readOnly={!!customer.id}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Phone
                      </label>

                      <input
                        value={customer.phone}
                        onChange={(e) =>
                          setCustomer((c) => ({
                            ...c,
                            phone: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Phone number"
                        readOnly={!!customer.id}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Address
                      </label>

                      <input
                        value={
                          customer.billing_address
                        }
                        onChange={(e) =>
                          setCustomer((c) => ({
                            ...c,
                            billing_address:
                              e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Billing address"
                        readOnly={!!customer.id}
                      />
                    </div>

                  </div>
                </div>
              ) : (
                <div
                  ref={customerRef}
                  className="relative"
                >
                  <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                    <input
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(
                          e.target.value
                        );
                        setShowCustomerDropdown(
                          true
                        );
                      }}
                      onFocus={() =>
                        setShowCustomerDropdown(
                          true
                        )}
                      className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Search existing customer by name or phone..."
                    />
                  </div>

                  <button
                    onClick={selectWalkInCustomer}
                    className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 whitespace-nowrap"
                  >
                    <Store className="w-4 h-4" />
                    Walk-in Customer
                  </button>
                  </div>

                  {showCustomerDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
                      {filteredCustomers.length >
                      0 ? (
                        filteredCustomers.map(
                          (c) => (
                            <button
                              key={c.id}
                              onClick={() =>
                                selectExistingCustomer(
                                  c
                                )
                              }
                              className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {c.name}
                              </p>

                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {c.phone ||
                                  "No phone"}
                              </p>
                            </button>
                          )
                        )
                      ) : (
                        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                          No customers found
                        </div>
                      )}

                      <div className="border-t border-gray-200 dark:border-gray-700 p-2">
                        <button
                          onClick={() => {
                            setShowNewCustomerForm(
                              true
                            );
                            setShowCustomerDropdown(
                              false
                            );
                            setCustomer((c) => ({
                              ...c,
                              name: customerSearch,
                            }));
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg"
                        >
                          <UserPlus className="w-4 h-4" />

                          {customerSearch
                            ? <>Add &quot;{customerSearch}&quot; as new customer</>
                            : "Add new customer"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Line Items */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  Items
                </h3>
              </div>

              {/* Product Search */}
              <div
                ref={productRef}
                className="relative mb-4"
              >
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                  <input
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(
                        e.target.value
                      );
                      setShowProductDropdown(
                        true
                      );
                    }}
                    onFocus={() =>
                      setShowProductDropdown(
                        true
                      )}
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Search and add products by name or SKU..."
                  />
                </div>

                {showProductDropdown &&
                  productSearch.trim().length >=
                    2 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto">
                      {filteredProducts.length >
                      0 ? (
                        filteredProducts.map(
                          (p) => (
                            <button
                              key={p.id}
                              onClick={() =>
                                addProduct(p)
                              }
                              className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                              <div className="flex justify-between">
                                <div>
                                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    {p.name}
                                  </p>

                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                    SKU:{" "}
                                    {p.sku} •
                                    Stock:{" "}
                                    <span
                                      className={cn(
                                        p.stock_quantity <=
                                          p.min_stock_level
                                          ? "text-red-500 font-bold"
                                          : ""
                                      )}
                                    >
                                      {
                                        p.stock_quantity
                                      }{" "}
                                      {
                                        p.unit_of_measure
                                      }
                                    </span>
                                  </p>
                                </div>

                                <div className="text-right">
                                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    {formatCurrency(
                                      p.unit_price
                                    )}
                                  </p>
                                </div>
                              </div>
                            </button>
                          )
                        )
                      ) : (
                        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                          No products found
                        </div>
                      )}
                    </div>
                  )}
              </div>

              {/* Line Items Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      <th className="pb-2 text-left">
                        Description
                      </th>
                      <th className="pb-2 text-right w-20">
                        Qty
                      </th>
                      <th className="pb-2 text-right w-28">
                        Price
                      </th>
                      <th className="pb-2 text-right w-20">
                        Disc%
                      </th>
                      <th className="pb-2 text-right w-28">
                        Total
                      </th>
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {pricedLines.map((line) => (
                      <tr key={line.id}>
                        <td className="py-2 pr-2">
                          <input
                            value={
                              line.description
                            }
                            onChange={(e) =>
                              updateLine(
                                line.id,
                                "description",
                                e.target.value
                              )
                            }
                            className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder="Item description"
                          />
                        </td>

                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={
                              line.quantity
                            }
                            onChange={(e) =>
                              updateLine(
                                line.id,
                                "quantity",
                                parseFloat(
                                  e.target.value
                                ) || 0
                              )
                            }
                            className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>

                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={
                              line.unit_price
                            }
                            onChange={(e) =>
                              updateLine(
                                line.id,
                                "unit_price",
                                parseFloat(
                                  e.target.value
                                ) || 0
                              )
                            }
                            className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>

                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={
                              line.discount_percentage
                            }
                            onChange={(e) =>
                              updateLine(
                                line.id,
                                "discount_percentage",
                                parseFloat(
                                  e.target.value
                                ) || 0
                              )
                            }
                            className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>

                        <td className="py-2 pl-1 text-right text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(
                            line.total_amount
                          )}
                        </td>

                        <td className="py-2 pl-2">
                          <button
                            onClick={() =>
                              removeLine(
                                line.id
                              )
                            }
                            className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={addEmptyLine}
                className="mt-3 flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add custom line item
              </button>
            </div>

            {/* Invoice dates & notes */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">
                Details
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Issue Date
                  </label>

                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) =>
                      setIssueDate(
                        e.target.value
                      )
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Due Date
                  </label>

                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) =>
                      setDueDate(
                        e.target.value
                      )
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Notes
                  </label>

                  <textarea
                    value={notes}
                    onChange={(e) =>
                      setNotes(e.target.value)
                    }
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Additional notes for this invoice..."
                  />
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Summary */}
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 sticky top-6">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">
                Summary
              </h3>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    Subtotal
                  </span>

                  <span className="text-gray-900 dark:text-white font-medium">
                    {formatCurrency(
                      subtotal
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Overall Discount (%)
                  </span>

                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={globalDiscount}
                    onChange={(e) =>
                      setGlobalDiscount(
                        clampNumber(
                          parseFloat(e.target.value),
                          0,
                          100
                        )
                      )
                    }
                    className="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {globalDiscountAmt > 0 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400">
                    <span>
                      Discount
                    </span>

                    <span>
                      -{" "}
                      {formatCurrency(
                        globalDiscountAmt
                      )}
                    </span>
                  </div>
                )}

                {/* Payment Section */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Payment Section
                    </span>

                    <span
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider",
                        computedStatus ===
                          "paid" &&
                          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
                        computedStatus ===
                          "partially_paid" &&
                          "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                        computedStatus ===
                          "due" &&
                          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      )}
                    >
                      {computedStatus ===
                      "paid"
                        ? "PAID"
                        : computedStatus ===
                            "partially_paid"
                          ? "PARTIALLY PAID"
                          : "DUE"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-gray-50 dark:bg-gray-900/50 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Total Amount
                    </span>

                    <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                      {formatCurrency(
                        grandTotal
                      )}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Paid Amount (₹) *
                    </label>

                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={grandTotal}
                      value={
                        paidAmountInput
                      }
                      onChange={(e) =>
                        setPaidAmountInput(
                          e.target.value
                        )
                      }
                      className={cn(
                        "w-full px-3 py-2 text-base font-semibold text-right border rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2",
                        isPaidExceedingTotal
                          ? "border-red-500 focus:ring-red-500 text-red-600"
                          : "border-gray-300 dark:border-gray-600 focus:ring-indigo-500 text-emerald-600 dark:text-emerald-400"
                      )}
                      placeholder="0.00"
                    />

                    {isPaidExceedingTotal && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 inline" />
                        Paid Amount cannot exceed Total Amount (
                        {formatCurrency(
                          grandTotal
                        )}
                        )
                      </p>
                    )}
                  </div>

                  <div className="flex justify-between items-center bg-amber-50 dark:bg-amber-900/20 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800/50">
                    <span className="text-sm font-semibold text-amber-900 dark:text-amber-300">
                      Balance Amount
                    </span>

                    <span className="text-base font-bold text-amber-900 dark:text-amber-300">
                      {formatCurrency(
                        balanceAmount
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <button
                  onClick={() => {
                    if (
                      !customer.name.trim() ||
                      lines.every(
                        (l) =>
                          !l.description.trim()
                      )
                    ) {
                      setError(
                        "Add a customer and at least one item to preview."
                      );
                      return;
                    }

                    if (
                      isPaidExceedingTotal
                    ) {
                      setError(
                        `Paid Amount (${formatCurrency(
                          paidAmount
                        )}) cannot exceed Total Amount (${formatCurrency(
                          grandTotal
                        )}).`
                      );
                      return;
                    }

                    setError(null);
                    setShowPreview(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  Preview Bill
                </button>

                <button
                  onClick={() =>
                    handleSave()
                  }
                  disabled={
                    isSaving ||
                    isPaidExceedingTotal
                  }
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  Confirm &amp; Save Invoice
                </button>
              </div>

              <p className="mt-4 text-xs text-center text-gray-400 dark:text-gray-500">
                {
                  lines.filter(
                    (l) =>
                      l.description.trim()
                  ).length
                }{" "}
                item(s) • Stock decreases ONLY upon confirmed invoice
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bill Preview Modal */}
      {showPreview && (
        <BillPreview
          invoiceNumber="Assigned on save"
          issueDate={issueDate}
          dueDate={dueDate}
          customer={customer}
          lines={pricedLines.filter(
            (l) => l.description.trim()
          )}
          subtotal={subtotal}
          globalDiscountAmt={
            globalDiscountAmt
          }
          grandTotal={grandTotal}
          paidAmount={paidAmount}
          balanceAmount={balanceAmount}
          paymentStatus={computedStatus}
          notes={notes}
          onClose={() =>
            setShowPreview(false)
          }
          onConfirm={() => {
            setShowPreview(false);
            handleSave();
          }}
          isSaving={isSaving}
        />
      )}
    </>
  );
}