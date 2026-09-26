"use client";

import { useState, useEffect } from "react";
import { db } from '@/lib/db';
import type { Product, Category } from "@/types/database";
import { Plus, Pencil, Trash2, Package, Loader2, AlertCircle, Search, Filter } from "lucide-react";
import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";

export default function ProductsPage() {
  
  const [products, setProducts] = useState<(Product & { category?: Category })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    
    // Fetch categories for filter dropdown
    const { data: cats } = await db.from("categories").select("*");
    if (cats) setCategories(cats);

    // Fetch products
    const { data: prods, error: prodsError } = await db
      .from("products")
      .select("*, category:categories(*)")
      .order("created_at", { ascending: false })
      .limit(500);

    if (prodsError) {
      setError(prodsError.message);
    } else {
      // Join sometimes returns an array or single object depending on relation
      // We'll map it to handle both cases smoothly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = (prods as any[])?.map(p => ({
        ...p,
        category: Array.isArray(p.category) ? p.category[0] : p.category
      })) || [];
      setProducts(mapped);
    }
    
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this product?")) return;
    
    const { error } = await db.from("products").delete().eq("id", id);
    if (error) {
      alert("Error deleting product: " + error.message);
    } else {
      await fetchData();
    }
  };

  // Filter products based on search query and category filter
  const filteredProducts = products.filter((prod) => {
    const matchesSearch = 
      prod.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prod.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory ? prod.category_id === selectedCategory : true;
    
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Products</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your product catalog and inventory
          </p>
        </div>
        <Link
          href="/dashboard/products/new"
          className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="relative sm:w-64">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <Package className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">No products yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Products will appear here once you add them.
          </p>
          <Link
            href="/dashboard/products/new"
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </Link>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No products match your search criteria.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Price</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Stock</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredProducts.map((prod) => (
                <tr key={prod.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{prod.name}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">SKU: {prod.sku} {prod.hsn_sac ? `• HSN: ${prod.hsn_sac}` : ''}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {prod.category?.name || "—"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(prod.unit_price)}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">+ {prod.tax_rate}% GST</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className={cn(
                      "text-sm font-medium",
                      prod.stock_quantity <= prod.min_stock_level ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"
                    )}>
                      {prod.stock_quantity} {prod.unit_of_measure}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link
                      href={`/dashboard/products/${prod.id}`}
                      className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-4 inline-block"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => handleDelete(prod.id)}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 inline-block"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
