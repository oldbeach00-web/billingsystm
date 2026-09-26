"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getExpectedPassword, createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServerClient } from "@supabase/ssr";

// ─── Helper: create a server-side Supabase client that reads/writes cookies ──
async function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseKey, {
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

export async function loginAction(
  password: string
): Promise<{ success: boolean; error?: string }> {
  if (!password || typeof password !== "string") {
    return { success: false, error: "Password is required." };
  }

  const expectedPassword = getExpectedPassword();

  if (password.trim() !== expectedPassword.trim()) {
    return { success: false, error: "Incorrect password. Please try again." };
  }

  const cookieStore = await cookies();
  const sessionToken = createSessionToken(expectedPassword);

  // ── Set custom auth session cookie ────────────────────────────────────────
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  // ── Also sign into Supabase Auth for proper RLS + real created_by UUID ────
  // Uses a dedicated admin account whose credentials are in env vars.
  // This is non-blocking — login still succeeds even if Supabase Auth fails.
  const adminEmail = process.env.SUPABASE_ADMIN_EMAIL;
  const adminPassword = process.env.SUPABASE_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    try {
      const supabase = await getServerSupabase();
      if (supabase) {
        // Try sign-in first
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: adminEmail,
          password: adminPassword,
        });

        if (signInError) {
          // User might not exist yet — attempt signup (first run only)
          const { error: signUpError } = await supabase.auth.signUp({
            email: adminEmail,
            password: adminPassword,
          });

          if (!signUpError) {
            // Try signing in again after signup
            await supabase.auth.signInWithPassword({
              email: adminEmail,
              password: adminPassword,
            });
          }
        }
      }
    } catch {
      // Supabase Auth failure is non-fatal — custom cookie auth still works
    }
  }

  return { success: true };
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();

  // ── Clear custom auth session cookie ─────────────────────────────────────
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  // ── Also sign out of Supabase Auth ────────────────────────────────────────
  try {
    const supabase = await getServerSupabase();
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch {
    // Non-fatal — custom cookie is already cleared
  }

  redirect("/login");
}
