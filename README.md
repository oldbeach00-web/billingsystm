# Billing & Inventory Management System

A production-grade, full-stack GST Billing & Inventory Management System built with **Next.js 16 (Turbopack)**, **TypeScript**, and **Tailwind CSS v4**.

---

## 🚀 Key Features

- **Dashboard**: Real-time business metrics (Total Sales, Total Paid, Total Balance, Invoices, Low-Stock Alerts).
- **Product & Category Management**: Full CRUD operations with SKU, HSN/SAC codes, Purchase & Selling prices, GST rates, and stock thresholds.
- **Inventory Management**: Real-time stock tracking, manual adjustments (additions/reductions), movement audit logs, and low-stock warnings.
- **POS / New Bill Screen**: Product search, customer inline creation, line item discounts, auto-calculated GST & subtotal, and pre-confirmation bill preview.
- **Payment Processing**: Staff manual paid amount entry, automatic balance calculation (`Total - Paid`), and status handling (`PAID`, `PARTIALLY PAID`, `DUE`).
- **Invoice History & A4 Printable Layout**: Printable GST Tax Invoice template formatted to standard A4 dimensions (210mm x 297mm) with reprinting support.
- **Customer & Due Management**: Track customer purchase history and manage outstanding invoice balances with payment history logs.
- **Reports & Analytics**: Daily, Weekly, Monthly, Yearly sales totals, Product sales reports, Customer analytics, Stock reports, and Date Range filters.
- **Shop Settings**: Dynamic store configuration (Name, Address, Phone, Email, GSTIN, Logo, Terms & Conditions) automatically integrated into printable invoices.

---

## 🛠️ Environment Configuration

Create a `.env.local` file in the root directory:

```env
# App Configuration
NEXT_PUBLIC_APP_NAME="Billing & Inventory Manager"
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Login password for the app, and a long random string used to sign sessions
# (e.g. `openssl rand -base64 32`). Changing either logs everyone out.
AUTH_PASSWORD=your-secret-password
SESSION_SECRET=long-random-string

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# Dedicated Supabase Auth user the app signs in as after a successful login
SUPABASE_ADMIN_EMAIL=admin@yourshop.com
SUPABASE_ADMIN_PASSWORD=strong-password
```

### Database setup

1. In Supabase → Authentication → Users, create the user named in `SUPABASE_ADMIN_EMAIL`.
2. Back up the database, then edit the admin email in
   `supabase/migrations/20261026000000_security_and_atomic_billing.sql`
   and run that file in the SQL editor. It locks every table to that user
   (Row Level Security) and adds the atomic `create_invoice`, `record_payment`
   and `adjust_stock` functions the app requires.
3. Authentication → Providers → Email: turn **off** "Allow new users to sign up".

---

## 💻 Getting Started

First, install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
