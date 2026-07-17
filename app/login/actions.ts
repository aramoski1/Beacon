"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

export async function signIn(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
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

  const { error } = await supabase.auth.signUp({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/onboarding`,
    },
  });

  if (error) return { error: authErrorMessage(error) };

  return { message: "Check your email to confirm your account." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
