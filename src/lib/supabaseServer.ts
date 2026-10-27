import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getSupabaseEnv } from "@/lib/supabaseEnv";
import { supabaseFetch } from "@/lib/supabaseFetch";

/** Supabase stores its session in cookies named sb-<project>-auth-token[.N]. */
export function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-");
}

/**
 * Server-side Supabase client that carries the signed-in admin session from
 * the request cookies, so Row Level Security sees an authenticated user.
 *
 * Server Components can't write cookies, so a token refreshed here can't be
 * saved; src/proxy.ts refreshes the session first on every request.
 */
export async function getServerSupabase() {
  const env = getSupabaseEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.key, {
    global: { fetch: supabaseFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll is called in Server Components where cookies are read-only — safe to ignore
        }
      },
    },
  });
}

/**
 * Server client for signing in: it ignores and removes any Supabase session
 * cookies already in the request. Otherwise the client would refresh the old
 * session at the same moment as the new sign-in, and the two writes race for
 * the same cookies (leaving the next page load with a stale token).
 */
export async function getFreshServerSupabase() {
  const env = getSupabaseEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookie(cookie.name)) cookieStore.delete(cookie.name);
  }

  // The client only ever sees the session it writes itself
  const written = new Map<string, string>();

  return createServerClient<Database>(env.url, env.key, {
    cookies: {
      getAll() {
        return Array.from(written, ([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          if (value) written.set(name, value);
          else written.delete(name);
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}
