import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the link inside Supabase confirmation emails.
// Supabase redirects to /auth/callback?code=<one-time-code> after the user
// clicks their email link; we exchange that code for a session here.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Something went wrong — send to login with an error hint.
  return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
}
