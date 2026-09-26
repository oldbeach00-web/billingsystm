"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { db } from '@/lib/db';
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
} from "lucide-react";
import { cn, formatCurrency, generateInvoiceNumber } from "@/lib/utils";
import { BillPreview } from "@/components/invoices/BillPreview";

// ─── Draft Persistence ────────────────────────────────────────────────────────
const DRAFT_KEY = "new_invoice_draft_v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BillLineItem {
  id: string; // local UUID for UI key
  product_id: string | null;
  product?: Product;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  discount_percentage: number;
  // computed
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
}

export interface BillCustomer {
  id: string | null; // null = walk-in / new
  name: string;
  phone: string;
  billing_address: string;
  gstin: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeLine(line: Omit<BillLineItem, "discount_amount" | "tax_amount" | "total_amount">): BillLineItem {
  const base = line.quantity * line.unit_price;
  const discount_amount = base * (line.discount_percentage / 100);
  const taxable = base - discount_amount;
  const tax_amount = taxable * (line.tax_rate / 100);
  const total_amount = taxable + tax_amount;
  return { ...line, discount_amount, tax_amount, total_amount };
}

function newLineItem(product?: Product): BillLineItem {
  const draft = {
    id: crypto.randomUUID(),
    product_id: product?.id ?? null,
    product,
    description: product?.name ?? "",
    quantity: 1,
    unit_price: product?.unit_price ?? 0,
    tax_rate: product?.tax_rate ?? 0,
    discount_percentage: 0,
    discount_amount: 0,
    tax_amount: 0,
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
  const [invoiceNumber] = useState(generateInvoiceNumber());
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
  });
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<BillLineItem[]>([newLineItem()]);
  const [globalDiscount, setGlobalDiscount] = useState(0); // %

  // Stage 6 Payment state
  const [paidAmountInput, setPaidAmountInput] = useState("0");

  // Customer state
  const [customer, setCustomer] = useState<BillCustomer>({
    id: null,
    name: "",
    phone: "",
    billing_address: "",
    gstin: "",
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
    (async () => {
      const [{ data: prods }, { data: custs }] = await Promise.all([
        db.from("products").select("*").eq("is_active", true).order("name").limit(500),
        db.from("customers").select("*").eq("is_active", true).order("name").limit(500),
      ]);
      const loadedProducts: Product[] = prods || [];
      const loadedCustomers: Customer[] = custs || [];
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

          // Re-link product objects from the freshly loaded products list
          // so computed fields and stock checks work correctly
          const relinkedLines = saved.lines.map((l) => {
            if (l.product_id) {
              const freshProduct = loadedProducts.find((p) => p.id === l.product_id);
              return freshProduct ? { ...l, product: freshProduct } : l;
            }
            return l;
          });

          setCustomer(saved.customer);
          setCustomerSearch(saved.customerSearch || saved.customer.name);
          setLines(relinkedLines.length > 0 ? relinkedLines : [newLineItem()]);
          setGlobalDiscount(saved.globalDiscount ?? 0);
          setIssueDate(saved.issueDate);
          setDueDate(saved.dueDate);
          setNotes(saved.notes ?? "");
          setPaidAmountInput(saved.paidAmountInput ?? "0");
          setDraftRestored(true);
        }
      } catch {
        // Corrupt draft — silently ignore and start fresh
        localStorage.removeItem(DRAFT_KEY);
      }

      setIsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Auto-save draft to localStorage (debounced 600 ms) ──────────────────

  useEffect(() => {
    if (isLoading) return; // Don't save while initial data is loading
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
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
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, customerSearch, lines, globalDiscount, issueDate, dueDate, notes, paidAmountInput, isLoading]);

  // ─── Clear draft helper ───────────────────────────────────────────────────

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setCustomer({ id: null, name: "", phone: "", billing_address: "", gstin: "" });
    setCustomerSearch("");
    setLines([newLineItem()]);
    setGlobalDiscount(0);
    setIssueDate(new Date().toISOString().split("T")[0]);
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setDueDate(d.toISOString().split("T")[0]);
    setNotes("");
    setPaidAmountInput("0");
    setDraftRestored(false);
    setError(null);
  };

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false);
      }
      if (productRef.current && !productRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);


  // ─── Computed totals & Stage 6 Payment Logic ─────────────────────────────

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price - l.discount_amount, 0);
  const totalTax = lines.reduce((s, l) => s + l.tax_amount, 0);
  const globalDiscountAmt = subtotal * (globalDiscount / 100);
  const grandTotal = subtotal + totalTax - globalDiscountAmt;

  const paidAmount = parseFloat(paidAmountInput) || 0;
  const isPaidExceedingTotal = paidAmount > grandTotal;
  const balanceAmount = isPaidExceedingTotal ? 0 : Math.max(0, grandTotal - paidAmount);

  // Automatic Payment Status calculation according to Stage 6 rules:
  // Paid Amount = Total → PAID
  // Paid Amount > 0 but Balance > 0 → PARTIALLY PAID
  // Paid Amount = 0 → DUE
  let computedStatus: "paid" | "partially_paid" | "due" = "due";
  if (paidAmount >= grandTotal && grandTotal > 0) {
    computedStatus = "paid";
  } else if (paidAmount > 0 && balanceAmount > 0) {
    computedStatus = "partially_paid";
  } else {
    computedStatus = "due";
  }

  // ─── Customer handlers ────────────────────────────────────────────────────

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone || "").includes(customerSearch)
  );

  const selectExistingCustomer = (c: Customer) => {
    setCustomer({
      id: c.id,
      name: c.name,
      phone: c.phone || "",
      billing_address: c.billing_address || "",
      gstin: c.gstin || "",
    });
    setCustomerSearch(c.name);
    setShowCustomerDropdown(false);
    setShowNewCustomerForm(false);
  };

  const clearCustomer = () => {
    setCustomer({ id: null, name: "", phone: "", billing_address: "", gstin: "" });
    setCustomerSearch("");
    setShowNewCustomerForm(false);
  };

  // ─── Line item handlers ───────────────────────────────────────────────────

  const addProduct = (product: Product) => {
    const existing = lines.findIndex((l) => l.product_id === product.id);
    if (existing >= 0) {
      updateLine(lines[existing].id, "quantity", lines[existing].quantity + 1);
    } else {
      setLines((prev) => [...prev, newLineItem(product)]);
    }
    setProductSearch("");
    setShowProductDropdown(false);
  };

  const addEmptyLine = () => setLines((prev) => [...prev, newLineItem()]);

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = useCallback(
    (id: string, field: keyof BillLineItem, value: number | string) => {
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const updated = { ...l, [field]: value };
          return computeLine(updated);
        })
      );
    },
    []
  );

  const filteredProducts =
    productSearch.trim().length >= 2
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(productSearch.trim().toLowerCase()) ||
            p.sku.toLowerCase().includes(productSearch.trim().toLowerCase())
        )
      : [];

  // ─── STAGE 7: CONFIRM INVOICE & STOCK MANAGEMENT ──────────────────────────

  const handleSave = async (overrideStatus?: "draft") => {
    // Prevent duplicate submission if already processing
    if (isSaving) return;

    if (!customer.name.trim()) {
      setError("Please add a customer before confirming.");
      return;
    }
    
    const validLines = lines.filter((l) => l.description.trim());
    if (validLines.length === 0) {
      setError("Please add at least one valid item to the bill.");
      return;
    }

    const hasInvalidLine = validLines.some(l => Number(l.quantity) <= 0 || Number(l.unit_price) < 0);
    if (hasInvalidLine) {
      setError("Quantity must be strictly greater than 0, and prices cannot be negative.");
      return;
    }

    if (grandTotal < 0) {
      setError("Grand Total cannot be negative.");
      return;
    }

    if (isPaidExceedingTotal) {
      setError(`Paid Amount (${formatCurrency(paidAmount)}) cannot exceed Total Amount (${formatCurrency(grandTotal)}).`);
      return;
    }

    const finalStatus = overrideStatus === "draft" ? "draft" : computedStatus;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Authentication error. Please log in again.");

      // ── 1. PREVENT DUPLICATE INVOICE CREATION ────────────────────────────
      const { data: existingInv } = await db
        .from("invoices")
        .select("id")
        .eq("invoice_number", invoiceNumber)
        .single();

      if (existingInv) {
        throw new Error(`Invoice #${invoiceNumber} has already been created to prevent duplicates.`);
      }

      // ── 2. STAGE 7 PRODUCT & STOCK VALIDATION (for confirmed invoices) ───
      if (finalStatus !== "draft") {
        for (const line of validLines) {
          if (line.product_id) {
            const { data: prodData, error: prodErr } = await (db.from("products") as any)
              .select("id, name, stock_quantity, is_active")
              .eq("id", line.product_id)
              .single();

            if (prodErr || !prodData) {
              throw new Error(`Product "${line.description}" was not found in database.`);
            }

            if (!prodData.is_active) {
              throw new Error(`Product "${prodData.name}" is no longer active.`);
            }

            // Check stock availability
            if (Number(prodData.stock_quantity) < line.quantity) {
              throw new Error(
                `Insufficient stock for "${prodData.name}". Requested: ${line.quantity}, Available: ${prodData.stock_quantity}.`
              );
            }
          }
        }
      }

      // ── 3. CREATE / GET CUSTOMER ─────────────────────────────────────────
      let customerId = customer.id;
      if (!customerId && customer.name.trim()) {
        const { data: newCust, error: custErr } = await (db.from("customers") as any)
          .insert([{
            name: customer.name,
            phone: customer.phone || null,
            billing_address: customer.billing_address || null,
            gstin: customer.gstin || null,
            country: "India",
          }])
          .select()
          .single();
        if (custErr) throw new Error("Error creating customer: " + custErr.message);
        customerId = newCust.id;
      }

      if (!customerId) throw new Error("Customer record missing.");

      // ── 4. ATTEMPT ATOMIC STORED PROCEDURE (RPC) FIRST ─────────────────────
      const itemsPayload = validLines.map((l) => ({
        product_id: l.product_id || null,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        discount_percentage: l.discount_percentage,
        discount_amount: l.discount_amount,
        total_amount: l.total_amount,
      }));

      const { data: rpcRes, error: rpcErr } = await (db as any).rpc("confirm_invoice_transaction", {
        p_invoice_number: invoiceNumber,
        p_customer_id: customerId,
        p_status: finalStatus,
        p_issue_date: issueDate,
        p_due_date: dueDate,
        p_subtotal: subtotal,
        p_tax_amount: totalTax,
        p_discount_amount: globalDiscountAmt,
        p_total_amount: grandTotal,
        p_amount_paid: paidAmount,
        p_amount_due: balanceAmount,
        p_notes: notes || null,
        p_created_by: user.id,
        p_items: itemsPayload,
      });

      if (!rpcErr && rpcRes) {
        // RPC execution succeeded atomically!
        localStorage.removeItem(DRAFT_KEY);
        setSuccessMessage(`Invoice #${invoiceNumber} confirmed & created successfully!`);
        setTimeout(() => {
          router.push("/dashboard/invoices");
          router.refresh();
        }, 1500);
        return;
      }

      // ── 5. FALLBACK: JS SEQUENTIAL TRANSACTION LOGIC ───────────────────────
      // Insert Invoice Header
      const { data: invoice, error: invErr } = await (db.from("invoices") as any)
        .insert([{
          invoice_number: invoiceNumber,
          customer_id: customerId,
          status: finalStatus,
          issue_date: issueDate,
          due_date: dueDate,
          subtotal,
          tax_amount: totalTax,
          discount_amount: globalDiscountAmt,
          total_amount: grandTotal,
          amount_paid: paidAmount,
          notes: notes || null,
          created_by: user.id,
        }])
        .select()
        .single();

      if (invErr) throw new Error("Error creating invoice: " + invErr.message);

      // Insert Line Items
      const formattedItems = validLines.map((l) => ({
        invoice_id: invoice.id,
        product_id: l.product_id || null,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        discount_percentage: l.discount_percentage,
        discount_amount: l.discount_amount,
        total_amount: l.total_amount,
      }));

      const { error: itemsErr } = await (db.from("invoice_items") as any)
        .insert(formattedItems);

      if (itemsErr) throw new Error("Error creating invoice line items: " + itemsErr.message);

      // STAGE 7: Deduct Stock & Create Stock Movement records (ONLY AFTER CONFIRMED INVOICE)
      if (finalStatus !== "draft") {
        for (const line of validLines) {
          if (line.product_id) {
            // Get current stock before deduction
            const { data: pData } = await (db.from("products") as any)
              .select("stock_quantity")
              .eq("id", line.product_id)
              .single();

            const currentStock = Number(pData?.stock_quantity || 0);
            const newStock = currentStock - line.quantity;

            // 10. Deduct sold quantity from stock
            await (db.from("products") as any)
              .update({ stock_quantity: newStock })
              .eq("id", line.product_id);

            // 11. Create stock movement record
            await (db.from("stock_movements") as any).insert([{
              product_id: line.product_id,
              movement_type: "sale",
              quantity: -line.quantity,
              quantity_before: currentStock,
              quantity_after: newStock,
              reference_id: invoice.id,
              reference_type: "invoice",
              notes: `Sale via Invoice #${invoiceNumber}`,
              created_by: user.id,
            }]);
          }
        }
      }

      // 12. Save payment information (if paidAmount > 0)
      if (paidAmount > 0) {
        await (db.from("payments") as any).insert([{
          invoice_id: invoice.id,
          payment_date: issueDate,
          amount: paidAmount,
          payment_method: "cash",
          status: "completed",
          notes: `Initial payment for Invoice #${invoiceNumber}`,
          created_by: user.id,
        }]);
      }

      // 13. Return invoice number & redirect
      localStorage.removeItem(DRAFT_KEY);
      setSuccessMessage(`Invoice #${invoiceNumber} created successfully!`);
      setTimeout(() => {
        router.push("/dashboard/invoices");
        router.refresh();
      }, 1500);

    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred while saving the invoice.");
      setIsSaving(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

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
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">New Invoice</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">#{invoiceNumber}</p>
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
                if (!customer.name.trim() || lines.every((l) => !l.description.trim())) {
                  setError("Add a customer and at least one item to preview.");
                  return;
                }
                if (isPaidExceedingTotal) {
                  setError(`Paid Amount (${formatCurrency(paidAmount)}) cannot exceed Total Amount (${formatCurrency(grandTotal)}).`);
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
              onClick={() => handleSave("draft")}
              disabled={isSaving || isPaidExceedingTotal}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save Draft
            </button>
            <button
              onClick={() => handleSave()}
              disabled={isSaving || isPaidExceedingTotal}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Confirm Invoice
            </button>
          </div>
        </div>

        {draftRestored && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 rounded-lg flex items-center justify-between text-sm">
            <span>📋 Draft restored — your previous invoice data has been loaded.</span>
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
          {/* ── LEFT: Customer + Items ─────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Customer Section */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">
                Customer
              </h3>

              {customer.id || showNewCustomerForm ? (
                /* Customer selected or new form open */
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {showNewCustomerForm ? "New Walk-in Customer" : customer.name}
                    </span>
                    <button onClick={clearCustomer} className="text-gray-400 hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name *</label>
                      <input
                        value={customer.name}
                        onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Customer name"
                        readOnly={!!customer.id}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Phone</label>
                      <input
                        value={customer.phone}
                        onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Phone number"
                        readOnly={!!customer.id}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Address</label>
                      <input
                        value={customer.billing_address}
                        onChange={(e) => setCustomer((c) => ({ ...c, billing_address: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Billing address"
                        readOnly={!!customer.id}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">GSTIN (optional)</label>
                      <input
                        value={customer.gstin}
                        onChange={(e) => setCustomer((c) => ({ ...c, gstin: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="15-digit GSTIN"
                        readOnly={!!customer.id}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* Customer search */
                <div ref={customerRef} className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value);
                        setShowCustomerDropdown(true);
                      }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Search existing customer by name or phone..."
                    />
                  </div>
                  {showCustomerDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => selectExistingCustomer(c)}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{c.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{c.phone || "No phone"} {c.gstin ? `• GSTIN: ${c.gstin}` : ""}</p>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">No customers found</div>
                      )}
                      <div className="border-t border-gray-200 dark:border-gray-700 p-2">
                        <button
                          onClick={() => {
                            setShowNewCustomerForm(true);
                            setShowCustomerDropdown(false);
                            setCustomer((c) => ({ ...c, name: customerSearch }));
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg"
                        >
                          <UserPlus className="w-4 h-4" />
                          Add &quot;{customerSearch || "Walk-in"}&quot; as new customer
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

              {/* Product search */}
              <div ref={productRef} className="relative mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      setShowProductDropdown(true);
                    }}
                    onFocus={() => setShowProductDropdown(true)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Search and add products by name or SKU..."
                  />
                </div>
                {showProductDropdown && productSearch.trim().length >= 2 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto">
                    {filteredProducts.length > 0 ? (
                      filteredProducts.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => addProduct(p)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <div className="flex justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                SKU: {p.sku} • Stock: <span className={cn(p.stock_quantity <= p.min_stock_level ? "text-red-500 font-bold" : "")}>{p.stock_quantity} {p.unit_of_measure}</span>
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(p.unit_price)}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">+{p.tax_rate}% GST</p>
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">No products found</div>
                    )}
                  </div>
                )}
              </div>

              {/* Line items table */}
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      <th className="pb-2 text-left">Description</th>
                      <th className="pb-2 text-right w-20">Qty</th>
                      <th className="pb-2 text-right w-28">Price</th>
                      <th className="pb-2 text-right w-20">Disc%</th>
                      <th className="pb-2 text-right w-20">GST%</th>
                      <th className="pb-2 text-right w-28">Total</th>
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td className="py-2 pr-2">
                          <input
                            value={line.description}
                            onChange={(e) => updateLine(line.id, "description", e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder="Item description"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unit_price}
                            onChange={(e) => updateLine(line.id, "unit_price", parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={line.discount_percentage}
                            onChange={(e) => updateLine(line.id, "discount_percentage", parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={line.tax_rate}
                            onChange={(e) => updateLine(line.id, "tax_rate", parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 text-sm text-right border border-gray-200 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-2 pl-1 text-right text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(line.total_amount)}
                        </td>
                        <td className="py-2 pl-2">
                          <button
                            onClick={() => removeLine(line.id)}
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
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Additional notes for this invoice..."
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Summary & Stage 6 Payment Section ──────────────── */}
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 sticky top-6">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">
                Summary
              </h3>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Subtotal</span>
                  <span className="text-gray-900 dark:text-white font-medium">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Total GST</span>
                  <span className="text-gray-900 dark:text-white font-medium">{formatCurrency(totalTax)}</span>
                </div>

                {/* Global discount */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">Overall Discount (%)</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={globalDiscount}
                    onChange={(e) => setGlobalDiscount(parseFloat(e.target.value) || 0)}
                    className="w-20 px-2 py-1 text-sm text-right border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                {globalDiscountAmt > 0 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400">
                    <span>Discount</span>
                    <span>- {formatCurrency(globalDiscountAmt)}</span>
                  </div>
                )}

                {/* ── STAGE 6: PAYMENT SECTION ───────────────────────── */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Payment Section
                    </span>
                    <span
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider",
                        computedStatus === "paid" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
                        computedStatus === "partially_paid" && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                        computedStatus === "due" && "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      )}
                    >
                      {computedStatus === "paid" ? "PAID" : computedStatus === "partially_paid" ? "PARTIALLY PAID" : "DUE"}
                    </span>
                  </div>

                  {/* Total Amount (Read-only) */}
                  <div className="flex justify-between items-center bg-gray-50 dark:bg-gray-900/50 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total Amount</span>
                    <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                      {formatCurrency(grandTotal)}
                    </span>
                  </div>

                  {/* Paid Amount (Manually entered by staff) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Paid Amount (₹) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={grandTotal}
                      value={paidAmountInput}
                      onChange={(e) => setPaidAmountInput(e.target.value)}
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
                        Paid Amount cannot exceed Total Amount ({formatCurrency(grandTotal)})
                      </p>
                    )}
                  </div>

                  {/* Balance Amount (Formula: Total Amount - Paid Amount) */}
                  <div className="flex justify-between items-center bg-amber-50 dark:bg-amber-900/20 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800/50">
                    <span className="text-sm font-semibold text-amber-900 dark:text-amber-300">Balance Amount</span>
                    <span className="text-base font-bold text-amber-900 dark:text-amber-300">
                      {formatCurrency(balanceAmount)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <button
                  onClick={() => {
                    if (!customer.name.trim() || lines.every((l) => !l.description.trim())) {
                      setError("Add a customer and at least one item to preview.");
                      return;
                    }
                    if (isPaidExceedingTotal) {
                      setError(`Paid Amount (${formatCurrency(paidAmount)}) cannot exceed Total Amount (${formatCurrency(grandTotal)}).`);
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
                  onClick={() => handleSave()}
                  disabled={isSaving || isPaidExceedingTotal}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Confirm &amp; Save Invoice
                </button>
              </div>

              {/* Items count & Stock Notice */}
              <p className="mt-4 text-xs text-center text-gray-400 dark:text-gray-500">
                {lines.filter((l) => l.description.trim()).length} item(s) • Stock decreases ONLY upon confirmed invoice
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bill Preview Modal */}
      {showPreview && (
        <BillPreview
          invoiceNumber={invoiceNumber}
          issueDate={issueDate}
          dueDate={dueDate}
          customer={customer}
          lines={lines.filter((l) => l.description.trim())}
          subtotal={subtotal}
          totalTax={totalTax}
          globalDiscountAmt={globalDiscountAmt}
          grandTotal={grandTotal}
          paidAmount={paidAmount}
          balanceAmount={balanceAmount}
          paymentStatus={computedStatus}
          notes={notes}
          onClose={() => setShowPreview(false)}
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
