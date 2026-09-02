import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The shared top of every protected page.tsx: redirect to /login if there's
 * no session, or to /access-revoked if the admin has revoked this account.
 * Runs per-page (not layout), so it genuinely re-checks on every navigation
 * — see app/admin/actions.ts's requireAdmin() for the equivalent action-side
 * gate. The real revoke boundary is the admin_set_account_revoked() RPC and
 * its trigger guard on user_settings (scripts/migrate-admin-account-management.ts);
 * this just makes sure a revoked user is actually kicked out of the app.
 */
export async function requireUser(
  supabase: Supabase,
  opts?: { skipPilotAgreement?: boolean },
): Promise<User> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: settings } = await supabase
    .from("user_settings")
    .select("access_revoked_at, pilot_agreement_accepted_at")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (settings?.access_revoked_at) {
    await supabase.auth.signOut();
    redirect("/access-revoked");
  }

  if (!opts?.skipPilotAgreement && !settings?.pilot_agreement_accepted_at) {
    redirect("/pilot-agreement");
  }

  return user;
}
