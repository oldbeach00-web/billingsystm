import { ProductForm } from "@/components/products/ProductForm";
import { getServerSupabase } from "@/lib/supabaseServer";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit Product",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: PageProps) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  // Use the cookie-aware server client so RLS sees the signed-in session
  const supabase = await getServerSupabase();
  if (!supabase) {
    notFound();
  }

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !product) {
    notFound();
  }

  return <ProductForm initialData={product} />;
}
