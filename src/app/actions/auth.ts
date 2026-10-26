"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getExpectedPassword,
  createSessionToken,
  safeEqual,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import {
  clearLoginFailures,
  getLoginRetryAfter,
  recordLoginFailure,
} from "@/lib/rateLimit";
import {
  getFreshServerSupabase,
  getServerSupabase,
  isSupabaseAuthCookie,
} from "@/lib/supabaseServer";

async function getClientKey(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

export async function loginAction(
  password: string
): Promise<{ success: boolean; error?: string }> {
  if (!password || typeof password !== "string") {
    return { success: false, error: "Password is required." };
  }

  const clientKey = await getClientKey();
  const retryAfter = getLoginRetryAfter(clientKey);
  if (retryAfter > 0) {
    return {
      success: false,
      error: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    };
  }

  const expectedPassword = getExpectedPassword();

  if (!(await safeEqual(password, expectedPassword))) {
    recordLoginFailure(clientKey);
    return { success: false, error: "Incorrect password. Please try again." };
  }

  // ── Sign into Supabase Auth so database requests are authenticated ───────
  // Row Level Security only allows the dedicated admin account, so when the
  // database is configured a failed Supabase sign-in must fail the login.
  // A fresh client: refreshing a leftover session from an earlier login at
  // the same time as this sign-in would race for the session cookies
  const supabase = await getFreshServerSupabase();

  if (supabase) {
    const adminEmail = process.env.SUPABASE_ADMIN_EMAIL;
    const adminPassword = process.env.SUPABASE_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      return {
        success: false,
        error: "Server misconfigured: SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD are not set.",
      };
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });

    if (signInError) {
      return {
        success: false,
        error: "Database sign-in failed. Check the Supabase admin account credentials.",
      };
    }
  }

  clearLoginFailures(clientKey);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return { success: true };
}

export async function clearSessions(): Promise<void> {
  const cookieStore = await cookies();

  // ── Clear custom auth session cookie ─────────────────────────────────────
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  // ── Also sign out of Supabase Auth — this device only ─────────────────────
  // Every device signs in as the same shared admin account, so the default
  // (global) sign-out would revoke the database session on all of them.
  try {
    const supabase = await getServerSupabase();
    if (supabase) {
      await supabase.auth.signOut({ scope: "local" });
    }
  } catch {
    // Non-fatal — the cookies are cleared below either way
  }

  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookie(cookie.name)) cookieStore.delete(cookie.name);
  }
}

export async function logoutAction(): Promise<void> {
  await clearSessions();
  redirect("/login");
}
