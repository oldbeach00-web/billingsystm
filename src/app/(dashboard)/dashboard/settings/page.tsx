"use client";

import { useState, useEffect, useCallback } from "react";
import { db } from "@/lib/db";
import {
  Store,
  FileText,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle,
  Building,
  Mail,
  Phone,
  MapPin,
  Hash,
  Image as ImageIcon,
} from "lucide-react";

type SettingsFormData = {
  shop_name: string;
  shop_address: string;
  shop_phone: string;
  shop_email: string;
  shop_gstin: string;
  shop_logo: string;
  invoice_prefix: string;
  invoice_start_num: string;
  invoice_footer: string;
  terms_and_conditions: string;
};

type FetchSettingsResult = {
  formData: Partial<SettingsFormData>;
  error: string | null;
};

const defaultFormData: SettingsFormData = {
  shop_name: "BILLING & INVENTORY SYSTEM",
  shop_address: "123 Commercial Street, Business Hub, City - 400001",
  shop_phone: "+91 98765 43210",
  shop_email: "billing@example.com",
  shop_gstin: "27AAAAA0000A1Z5",
  shop_logo: "",
  invoice_prefix: "INV-",
  invoice_start_num: "1001",
  invoice_footer: "Thank you for your business!",
  terms_and_conditions:
    "1. Goods once sold will not be taken back or exchanged.\n2. Payment is due within agreed payment terms.",
};

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] =
    useState<SettingsFormData>(defaultFormData);

  const fetchSettings = useCallback(
    async (): Promise<FetchSettingsResult> => {
      const { data, error } = await db
        .from("settings")
        .select("*");

      if (error) {
        return {
          formData: {},
          error: error.message,
        };
      }

      if (!data || data.length === 0) {
        return {
          formData: {},
          error: null,
        };
      }

      const settingsMap: Record<string, string> = {};

      (data as { key: string; value: string }[]).forEach((row) => {
        settingsMap[row.key] = row.value;
      });

      return {
        formData: {
          shop_name: settingsMap.shop_name,
          shop_address: settingsMap.shop_address,
          shop_phone: settingsMap.shop_phone,
          shop_email: settingsMap.shop_email,
          shop_gstin: settingsMap.shop_gstin,
          shop_logo: settingsMap.shop_logo,
          invoice_prefix: settingsMap.invoice_prefix,
          invoice_start_num: settingsMap.invoice_start_num,
          invoice_footer: settingsMap.invoice_footer,
          terms_and_conditions: settingsMap.terms_and_conditions,
        },
        error: null,
      };
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      const result = await fetchSettings();

      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (Object.keys(result.formData).length > 0) {
        setFormData((prev) => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(result.formData).filter(
              ([, value]) => value !== undefined && value !== ""
            )
          ),
        }));
      }

      setIsLoading(false);
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const keys = Object.keys(formData) as (keyof typeof formData)[];

      const payload = keys.map((k) => ({
        key: k,
        value: formData[k],
        category: k.startsWith("shop") ? "general" : "billing",
        is_public: true,
      }));

      const { error: upsertErr } = await db
        .from("settings")
        .upsert(payload, {
          onConflict: "key",
        });

      if (upsertErr) {
        throw new Error(upsertErr.message);
      }

      setSuccess("Settings saved successfully!");

      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error saving settings."
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Store &amp; Invoice Settings
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Configure your shop details, logo, invoice prefix, footer, and terms
          </p>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={isSaving}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Settings
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg flex items-center gap-2 font-medium">
          <CheckCircle className="w-5 h-5 flex-shrink-0 text-emerald-600" />
          {success}
        </div>
      )}

      <form onSubmit={handleSaveSettings} className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-3">
            <Store className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Shop Details
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Shop Name *
              </label>

              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                <input
                  type="text"
                  required
                  value={formData.shop_name}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      shop_name: e.target.value,
                    })
                  }
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Acme Enterprises"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Shop Address
              </label>

              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-4 h-4 text-gray-400" />

                <textarea
                  rows={2}
                  value={formData.shop_address}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      shop_address: e.target.value,
                    })
                  }
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Street, Area, City, Pincode, State"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Shop Phone
              </label>

              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                <input
                  type="text"
                  value={formData.shop_phone}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      shop_phone: e.target.value,
                    })
                  }
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Shop Email
              </label>

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                <input
                  type="email"
                  value={formData.shop_email}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      shop_email: e.target.value,
                    })
                  }
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="contact@shop.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Shop GSTIN
              </label>

              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                <input
                  type="text"
                  value={formData.shop_gstin}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      shop_gstin: e.target.value,
                    })
                  }
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="15-digit GSTIN"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Logo URL (optional)
              </label>

              <div className="relative">
                <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                <input
                  type="url"
                  value={formData.shop_logo}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      shop_logo: e.target.value,
                    })
                  }
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://example.com/logo.png"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-3">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />

            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Invoice Customization
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Invoice Prefix
              </label>

              <input
                type="text"
                value={formData.invoice_prefix}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    invoice_prefix: e.target.value,
                  })
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. INV-"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Starting Invoice Number
              </label>

              <input
                type="text"
                value={formData.invoice_start_num}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    invoice_start_num: e.target.value,
                  })
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. 1001"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Invoice Footer Text
              </label>

              <input
                type="text"
                value={formData.invoice_footer}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    invoice_footer: e.target.value,
                  })
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Thank you message displayed at bottom of printed invoice"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Terms &amp; Conditions
              </label>

              <textarea
                rows={3}
                value={formData.terms_and_conditions}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    terms_and_conditions: e.target.value,
                  })
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Custom terms and conditions printed on invoices"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save All Settings
          </button>
        </div>
      </form>
    </div>
  );
}