import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every account belongs to exactly one active firm (Beacon_Team_Multitenancy_Plan.md §2.2).
 * Existing accounts got a personal firm via the one-time migrate-firms.ts backfill;
 * this covers every signup from here on. Idempotent and safe to call more than once —
 * a user with an active firm_members row already is left untouched.
 *
 * Runs on the newly-authenticated user's own client, so it relies on (and is bounded
 * by) firms_creator_insert / firm_members_self_bootstrap_insert RLS — no service role,
 * no privileged bypass.
 */
export async function ensurePersonalFirm(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("firm_members")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (existing) return;

  const { data: firm, error: firmError } = await supabase
    .from("firms")
    .insert({ name: "My team", created_by: userId })
    .select("id")
    .single();
  if (firmError || !firm) return; // best-effort — a missing firm degrades to "solo, no toggle," not a broken signup

  await supabase
    .from("firm_members")
    .insert({ firm_id: firm.id, user_id: userId, role: "owner", status: "active" });
}
