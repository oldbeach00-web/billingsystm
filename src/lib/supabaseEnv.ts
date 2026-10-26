/** Supabase URL and anon key, or null when the database isn't configured. */
export function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (
    !url ||
    !url.startsWith("http") ||
    url.includes("placeholder") ||
    !key ||
    key === "placeholder-key"
  ) {
    return null;
  }
  return { url, key };
}
