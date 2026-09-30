"use client";

import { useState, useEffect, useCallback } from "react";
import { db } from "@/lib/db";
import type { Category } from "@/types/database";
import {
  Plus,
  Pencil,
  Trash2,
  Tag,
  Loader2,
  AlertCircle,
} from "lucide-react";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [isSaving, setIsSaving] = useState(false);

  const fetchCategories = useCallback(async () => {
    const { data, error } = await db
      .from("categories")
      .select("*")
      .order("name");

    return {
      data: data || [],
      error: error ? error.message : null,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCategories = async () => {
      const result = await fetchCategories();

      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else {
        setCategories(result.data);
      }

      setIsLoading(false);
    };

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, [fetchCategories]);

  const refreshCategories = async () => {
    const result = await fetchCategories();

    if (result.error) {
      setError(result.error);
    } else {
      setCategories(result.data);
    }

    setIsLoading(false);
  };

  const handleOpenModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        name: category.name,
        description: category.description || "",
      });
    } else {
      setEditingCategory(null);
      setFormData({ name: "", description: "" });
    }

    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCategory(null);
    setFormData({ name: "", description: "" });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    if (editingCategory) {
      const { error } = await (
        db.from("categories") as {
          update: (data: unknown) => {
            eq: (
              k: string,
              v: string
            ) => Promise<{ error: { message: string } | null }>;
          };
          insert: (
            data: unknown[]
          ) => Promise<{ error: { message: string } | null }>;
          select: (s: string) => {
            eq: (k: string, v: string) => {
              single: () => Promise<{
                data: unknown;
                error: { message: string } | null;
              }>;
            };
          };
        }
      )
        .update({
          name: formData.name,
          description: formData.description,
        })
        .eq("id", editingCategory.id);

      if (error) {
        setError(error.message);
      } else {
        await refreshCategories();
        handleCloseModal();
      }
    } else {
      const { error } = await (
        db.from("categories") as {
          update: (data: unknown) => {
            eq: (
              k: string,
              v: string
            ) => Promise<{ error: { message: string } | null }>;
          };
          insert: (
            data: unknown[]
          ) => Promise<{ error: { message: string } | null }>;
          select: (s: string) => {
            eq: (k: string, v: string) => {
              single: () => Promise<{
                data: unknown;
                error: { message: string } | null;
              }>;
            };
          };
        }
      ).insert([
        {
          name: formData.name,
          description: formData.description,
        },
      ]);

      if (error) {
        setError(error.message);
      } else {
        await refreshCategories();
        handleCloseModal();
      }
    }

    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this category?")) {
      return;
    }

    const { error } = await db.from("categories").delete().eq("id", id);

    if (error) {
      alert("Error deleting category: " + error.message);
    } else {
      await refreshCategories();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Categories
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your product categories
          </p>
        </div>

        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Category
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      ) : categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <Tag className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />

          <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">
            No categories yet
          </h3>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Create your first category to start organizing products.
          </p>

          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Category
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Name
                </th>

                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Description
                </th>

                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {categories.map((cat) => (
                <tr
                  key={cat.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {cat.name}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs">
                    {cat.description || "—"}
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleOpenModal(cat)}
                      className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-4"
                    >
                      <Pencil className="w-4 h-4 inline" />
                    </button>

                    <button
                      onClick={() => handleDelete(cat.id)}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4 inline" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingCategory ? "Edit Category" : "Add Category"}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Category Name *
                </label>

                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      name: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., Electronics"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>

                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      description: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Optional description"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSaving || !formData.name.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSaving && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}

                  {editingCategory ? "Save Changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}