"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pilotConfirmUserEmail } from "@/lib/auth-pilot-confirm";
import { ensurePersonalFirm } from "@/lib/firms";

type ActionResult = { error: string } | { message: string } | null;

function authErrorMessage(error: { message: string; status?: number }): string {
  const msg = error.message.toLowerCase();
  if (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("enotfound") ||
    error.status === 0
  ) {
    return (
      "Cannot reach Supabase. Your project URL may be wrong, the project may be paused or deleted, " +
      "or your network DNS is blocking *.supabase.co. Check the Supabase dashboard and .env.local."
    );
  }
  return error.message;
}

/** Site origin for auth email links — prefer env, fall back to localhost for pilot. */
function siteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (raw) return raw;
  return "http://localhost:3000";
}

async function enterApp() {
  revalidatePath("/", "layout");
  redirect("/onboarding");
}

export async function signIn(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const email = (formData.get("email") as string)?.trim() ?? "";
  const password = formData.get("password") as string;

  // Pilot: confirm first so an earlier failed confirmation email doesn't block login.
  await pilotConfirmUserEmail(email);

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return { error: authErrorMessage(error) };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUp(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const email = (formData.get("email") as string)?.trim() ?? "";
  const password = formData.get("password") as string;
  const origin = siteOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Kept for when Confirm email + SMTP are enabled later.
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    // Already registered — confirm + try sign-in so stuck users aren't blocked.
    if (msg.includes("already") || msg.includes("registered")) {
      await pilotConfirmUserEmail(email);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!signInError) await enterApp();
      return {
        message:
          "That email already has an account. Use Sign in with your password (confirmation email is not required).",
      };
    }
    return { error: authErrorMessage(error) };
  }

  // Autoconfirm / Confirm-email-off → session on signup.
  if (data.session) await enterApp();

  // Confirm via Postgres, then sign in — skips the inbox entirely for pilot.
  await pilotConfirmUserEmail(email);

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (!signInError && data.user) await ensurePersonalFirm(supabase, data.user.id);
  if (!signInError) await enterApp();

  return {
    message:
      "Account ready. Confirmation email is not required for this pilot — use Sign in with the same email and password.",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
