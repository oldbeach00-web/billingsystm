"use client";

import { useState, useEffect } from "react";
import { db } from '@/lib/db';
import type { Product, StockMovement, Category, UserProfile } from "@/types/database";
import {
  Package,
  History,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  AlertCircle,
  Plus,
  Minus,
  Search,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

type Tab = "overview" | "movements";

export default function StockPage() {
  
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  
  // Data states
  const [products, setProducts] = useState<(Product & { category?: Category })[]>([]);
  const [movements, setMovements] = useState<(StockMovement & { product?: Product; user?: UserProfile })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyLowStock, setShowOnlyLowStock] = useState(false);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustType, setAdjustType] = useState<"addition" | "reduction" | "damage">("addition");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    if (activeTab === "overview") {
      const { data, error: fetchError } = await db
        .from("products")
        .select("*, category:categories(*)")
        .order("name")
        .limit(500);
      
      if (fetchError) setError(fetchError.message);
      else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = (data as any[])?.map(p => ({
          ...p,
          category: Array.isArray(p.category) ? p.category[0] : p.category
        })) || [];
        setProducts(mapped);
      }
    } else {
      const { data, error: fetchError } = await db
        .from("stock_movements")
        .select("*, product:products(*), user:user_profiles(*)")
        .order("created_at", { ascending: false })
        .limit(100);
        
      if (fetchError) setError(fetchError.message);
      else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = (data as any[])?.map(m => ({
          ...m,
          product: Array.isArray(m.product) ? m.product[0] : m.product,
          user: Array.isArray(m.user) ? m.user[0] : m.user
        })) || [];
        setMovements(mapped);
      }
    }
    
    setIsLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, [activeTab]);

  const handleOpenModal = (product: Product) => {
    setSelectedProduct(product);
    setAdjustType("addition");
    setAdjustQty("");
    setAdjustNotes("");
    setIsModalOpen(true);
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    
    const qty = parseFloat(adjustQty);
    if (isNaN(qty) || qty <= 0) {
      setError("Please enter a valid positive quantity");
      return;
    }

    setIsSaving(true);
    setError(null);

    // Get current auth user
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      setError("Authentication error. Please log in again.");
      setIsSaving(false);
      return;
    }

    // Determine actual quantity change and movement type
    let quantityChange = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let movementType: any = "adjustment";
    
    if (adjustType === "addition") {
      quantityChange = qty;
      movementType = "adjustment"; // or purchase if it was from a PO
    } else if (adjustType === "reduction") {
      quantityChange = -qty;
      movementType = "adjustment";
    } else if (adjustType === "damage") {
      quantityChange = -qty;
      movementType = "damage";
    }

    const currentStock = Number(selectedProduct.stock_quantity);
    const newStock = currentStock + quantityChange;

    // We use the two-step JS call for maximum compatibility if RPC is not created yet
    const { error: updateError } = await (db.from("products") as any)
      .update({ stock_quantity: newStock })
      .eq("id", selectedProduct.id);

    if (updateError) {
      setError(updateError.message);
      setIsSaving(false);
      return;
    }

    const { error: movementError } = await (db.from("stock_movements") as any)
      .insert([{
        product_id: selectedProduct.id,
        movement_type: movementType,
        quantity: quantityChange,
        quantity_before: currentStock,
        quantity_after: newStock,
        notes: adjustNotes || null,
        created_by: user.id
      }]);

    if (movementError) {
      // Revert stock (best effort)
      await (db.from("products") as any).update({ stock_quantity: currentStock }).eq("id", selectedProduct.id);
      setError("Error recording movement: " + movementError.message);
    } else {
      setIsModalOpen(false);
      await fetchData(); // Refresh data
    }
    
    setIsSaving(false);
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const isLowStock = p.stock_quantity <= p.min_stock_level;
    const matchesLowStock = showOnlyLowStock ? isLowStock : true;
    return matchesSearch && matchesLowStock;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Inventory Management</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Monitor stock levels and record adjustments
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab("overview")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "overview" 
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400" 
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          )}
        >
          <Package className="w-4 h-4 inline mr-2" />
          Current Stock
        </button>
        <button
          onClick={() => setActiveTab("movements")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "movements" 
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400" 
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          )}
        >
          <History className="w-4 h-4 inline mr-2" />
          Stock History
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search products by name or SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={showOnlyLowStock}
                onChange={(e) => setShowOnlyLowStock(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              Show Low Stock Only
            </label>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Product</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Current Stock</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Min Level</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredProducts.map((prod) => {
                    const isLowStock = prod.stock_quantity <= prod.min_stock_level;
                    return (
                      <tr key={prod.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{prod.name}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">SKU: {prod.sku} • {prod.category?.name || 'Uncategorized'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className="text-sm font-bold text-gray-900 dark:text-white">
                            {prod.stock_quantity} {prod.unit_of_measure}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500 dark:text-gray-400">
                          {prod.min_stock_level} {prod.unit_of_measure}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          {isLowStock ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                              <AlertTriangle className="w-3 h-3" />
                              Low Stock
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                              Adequate
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleOpenModal(prod)}
                            className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                          >
                            Adjust Stock
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        No products found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MOVEMENTS TAB */}
      {activeTab === "movements" && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date & Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Product</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Qty Change</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Before &rarr; After</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Notes & Ref</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {movements.map((mov) => {
                    const isPositive = mov.quantity > 0;
                    return (
                      <tr key={mov.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {formatDate(mov.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{mov.product?.name || 'Unknown'}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">SKU: {mov.product?.sku}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase",
                            mov.movement_type === 'sale' ? "bg-blue-100 text-blue-800" :
                            mov.movement_type === 'purchase' ? "bg-purple-100 text-purple-800" :
                            mov.movement_type === 'damage' ? "bg-red-100 text-red-800" :
                            "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                          )}>
                            {mov.movement_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className={cn(
                            "text-sm font-bold flex items-center justify-end gap-1",
                            isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                          )}>
                            {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                            {Math.abs(mov.quantity)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500 dark:text-gray-400">
                          {mov.quantity_before} &rarr; <span className="font-medium text-gray-900 dark:text-white">{mov.quantity_after}</span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-[200px] truncate">
                          {mov.notes || "—"}
                          {mov.reference_type && <span className="block text-xs opacity-75">{mov.reference_type} #{mov.reference_id?.slice(0,8)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {movements.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        No stock movements recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Adjust Stock Modal */}
      {isModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              Adjust Stock
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {selectedProduct.name} (SKU: {selectedProduct.sku})
            </p>
            
            <form onSubmit={handleAdjustStock} className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg flex justify-between items-center mb-4 border border-gray-200 dark:border-gray-700">
                <span className="text-sm text-gray-600 dark:text-gray-400">Current Stock</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">{selectedProduct.stock_quantity} {selectedProduct.unit_of_measure}</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Adjustment Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustType("addition")}
                    className={cn(
                      "flex flex-col items-center justify-center p-2 rounded-lg border text-sm transition-colors",
                      adjustType === "addition" 
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-400" 
                        : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    )}
                  >
                    <Plus className="w-5 h-5 mb-1" />
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustType("reduction")}
                    className={cn(
                      "flex flex-col items-center justify-center p-2 rounded-lg border text-sm transition-colors",
                      adjustType === "reduction" 
                        ? "border-amber-600 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:border-amber-500 dark:text-amber-400" 
                        : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    )}
                  >
                    <Minus className="w-5 h-5 mb-1" />
                    Reduce
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustType("damage")}
                    className={cn(
                      "flex flex-col items-center justify-center p-2 rounded-lg border text-sm transition-colors",
                      adjustType === "damage" 
                        ? "border-red-600 bg-red-50 text-red-700 dark:bg-red-900/30 dark:border-red-500 dark:text-red-400" 
                        : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    )}
                  >
                    <AlertTriangle className="w-5 h-5 mb-1" />
                    Damage
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quantity ({selectedProduct.unit_of_measure}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. 50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Notes / Reason
                </label>
                <textarea
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Why is this adjustment being made?"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-2 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !adjustQty}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
