import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_NAME, isValidSessionToken } from "@/lib/auth";
import { getSupabaseEnv } from "@/lib/supabaseEnv";

/**
 * Refreshes the Supabase session (if its access token has expired) and writes
 * the new tokens to both the forwarded request and the response. Server
 * Components can't set cookies, so without this a refresh during rendering
 * is lost, and the single-use refresh token eventually stops working.
 */
async function refreshSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const env = getSupabaseEnv();
  if (!env) return response;

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  try {
    // Refreshes the access token when it is about to expire; otherwise no
    // network call. Whether the user may enter was already decided by the
    // app's signed cookie above, and the database verifies the token itself.
    await supabase.auth.getSession();
  } catch {
    // Network trouble: let the page render and report its own error
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets and internal next requests pass through
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = await isValidSessionToken(sessionToken);

  const publicRoutes = ["/login"];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

  // If user is not authenticated and trying to access dashboard/protected routes
  if (!isAuthenticated && !isPublicRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    if (pathname !== "/") {
      redirectUrl.searchParams.set("redirectedFrom", pathname);
    }
    return NextResponse.redirect(redirectUrl);
  }

  // If user is authenticated and trying to access login page
  if (isAuthenticated && isPublicRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthenticated) {
    return refreshSupabaseSession(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
