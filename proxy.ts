import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";

// Two jobs:
//
//   1. Session refresh + the original blanket "no session -> /login"
//      redirect for any non-public path. This existed before this change
//      (git history — do not remove it again).
//   2. Fire-and-forget page-view logging for the admin's per-account
//      activity timeline (app/admin/account-detail.tsx), added here.
//
// The revoke check is NOT here, on purpose: it's specific to an
// already-authenticated session (a valid user whose access.was pulled), so
// it belongs in the DAL — requireUser() (lib/auth-require-user.ts), called
// from every protected page.tsx, which re-runs on every navigation to that
// route and redirects to /access-revoked rather than /login.
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Skip session refresh until credentials are configured.
  if (!url || !key || url === "your-project-url-here") {
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refreshes the session cookie so it never silently expires mid-visit.
  // Capture the user so we can enforce auth below without a second network call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public paths that don't require authentication.
  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/auth/") ||
    pathname === "/access-revoked";

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Preserve the original destination so we can redirect back after sign-in.
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Page-view logging — skip prefetches (the user never actually viewed
  // that page) and non-GET requests, per the docs' negative-matching
  // guidance. Best-effort: never blocks or breaks the actual page request.
  const isPrefetch =
    request.headers.get("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch";

  if (user && !isPrefetch && request.method === "GET") {
    const path = pathname;
    event.waitUntil(
      Promise.all([
        supabase.from("activity_log").insert({ user_id: user.id, path, method: "GET" }),
        supabase.from("user_settings").update({ last_active_at: new Date().toISOString() }).eq("owner_id", user.id),
      ]).catch(() => {})
    );
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
