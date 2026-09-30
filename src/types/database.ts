// Database types matching the PostgreSQL schema

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export type UserRole = "admin" | "manager" | "staff";
export type InvoiceStatus =
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "cancelled"
  | "partially_paid"
  | "due";
export type PaymentMethod =
  | "cash"
  | "card"
  | "bank_transfer"
  | "upi"
  | "cheque"
  | "other";
export type PaymentStatus =
  | "pending"
  | "completed"
  | "failed"
  | "refunded";
export type StockMovementType =
  | "purchase"
  | "sale"
  | "adjustment"
  | "return"
  | "damage";
export type SettingCategory =
  | "general"
  | "billing"
  | "tax"
  | "notifications"
  | "appearance";

// ─────────────────────────────────────────────
// Table Row Types
// ─────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  hsn_sac: string | null;
  category_id: string | null;
  unit_price: number;
  cost_price: number;
  tax_rate: number;
  unit_of_measure: string;
  stock_quantity: number;
  min_stock_level: number;
  max_stock_level: number | null;
  is_active: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  category?: Category;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  credit_limit: number;
  outstanding_balance: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  amount_paid: number;
  amount_due: number;
  notes: string | null;
  terms: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  customer?: Customer;
  items?: InvoiceItem[];
  payments?: Payment[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  discount_percentage: number;
  discount_amount: number;
  total_amount: number;
  created_at: string;
  product?: Product;
}

export interface Payment {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount: number;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  reference_number: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  movement_type: StockMovementType;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference_id: string | null;
  reference_type: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  product?: Product;
}

export interface Setting {
  id: string;
  key: string;
  value: Json;
  category: SettingCategory;
  description: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────
// Notification
// ─────────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  type: "error" | "warning" | "info";
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

// ─────────────────────────────────────────────
// Database Schema Type
// ─────────────────────────────────────────────

export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: UserProfile;
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          role?: UserRole;
          phone?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          role?: UserRole;
          phone?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      categories: {
        Row: Category;
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          parent_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          parent_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      products: {
        Row: Product;
        Insert: {
          id?: string;
          sku: string;
          name: string;
          description?: string | null;
          hsn_sac?: string | null;
          category_id?: string | null;
          unit_price?: number;
          cost_price?: number;
          tax_rate?: number;
          unit_of_measure?: string;
          stock_quantity?: number;
          min_stock_level?: number;
          max_stock_level?: number | null;
          is_active?: boolean;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sku?: string;
          name?: string;
          description?: string | null;
          hsn_sac?: string | null;
          category_id?: string | null;
          unit_price?: number;
          cost_price?: number;
          tax_rate?: number;
          unit_of_measure?: string;
          stock_quantity?: number;
          min_stock_level?: number;
          max_stock_level?: number | null;
          is_active?: boolean;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      customers: {
        Row: Customer;
        Insert: {
          id?: string;
          name: string;
          email?: string | null;
          phone?: string | null;
          gstin?: string | null;
          billing_address?: string | null;
          shipping_address?: string | null;
          city?: string | null;
          state?: string | null;
          pincode?: string | null;
          country?: string;
          credit_limit?: number;
          outstanding_balance?: number;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          full_name?: string;
          phone?: string | null;
          gstin?: string | null;
          billing_address?: string | null;
          shipping_address?: string | null;
          city?: string | null;
          state?: string | null;
          pincode?: string | null;
          country?: string;
          credit_limit?: number;
          outstanding_balance?: number;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      invoices: {
        Row: Invoice;
        Insert: {
          id?: string;
          invoice_number: string;
          customer_id: string;
          status?: InvoiceStatus;
          issue_date?: string;
          due_date: string;
          subtotal?: number;
          tax_amount?: number;
          discount_amount?: number;
          total_amount?: number;
          amount_paid?: number;
          notes?: string | null;
          terms?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          invoice_number?: string;
          customer_id?: string;
          status?: InvoiceStatus;
          issue_date?: string;
          due_date?: string;
          subtotal?: number;
          tax_amount?: number;
          discount_amount?: number;
          total_amount?: number;
          amount_paid?: number;
          notes?: string | null;
          terms?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      invoice_items: {
        Row: InvoiceItem;
        Insert: {
          id?: string;
          invoice_id: string;
          product_id?: string | null;
          description: string;
          quantity?: number;
          unit_price?: number;
          tax_rate?: number;
          tax_amount?: number;
          discount_percentage?: number;
          discount_amount?: number;
          total_amount?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          product_id?: string | null;
          description?: string;
          quantity?: number;
          unit_price?: number;
          tax_rate?: number;
          tax_amount?: number;
          discount_percentage?: number;
          discount_amount?: number;
          total_amount?: number;
          created_at?: string;
        };
        Relationships: [];
      };

      payments: {
        Row: Payment;
        Insert: {
          id?: string;
          invoice_id: string;
          payment_date?: string;
          amount: number;
          payment_method?: PaymentMethod;
          status?: PaymentStatus;
          reference_number?: string | null;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          payment_date?: string;
          amount?: number;
          payment_method?: PaymentMethod;
          status?: PaymentStatus;
          reference_number?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      stock_movements: {
        Row: StockMovement;
        Insert: {
          id?: string;
          product_id: string;
          movement_type: StockMovementType;
          quantity: number;
          quantity_before: number;
          quantity_after: number;
          reference_id?: string | null;
          reference_type?: string | null;
          notes?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          movement_type?: StockMovementType;
          quantity?: number;
          quantity_before?: number;
          quantity_after?: number;
          reference_id?: string | null;
          reference_type?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };

      settings: {
        Row: Setting;
        Insert: {
          id?: string;
          key: string;
          value?: Json;
          category?: SettingCategory;
          description?: string | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          key?: string;
          value?: Json;
          category?: SettingCategory;
          description?: string | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      notifications: {
        Row: Notification;
        Insert: {
          id?: string;
          user_id: string;
          type?: "error" | "warning" | "info";
          title: string;
          message: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: "error" | "warning" | "info";
          title?: string;
          message?: string;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
    };

    Views: Record<string, never>;

    Functions: Record<string, never>;

    Enums: {
      user_role: UserRole;
      invoice_status: InvoiceStatus;
      payment_method: PaymentMethod;
      payment_status: PaymentStatus;
      stock_movement_type: StockMovementType;
      setting_category: SettingCategory;
    };
  };
};