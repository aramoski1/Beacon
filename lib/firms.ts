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

/** Cheaper than getWorkspaceTeamContext when only the solo/multi-member check is needed (detail pages' share toggle). */
export async function isSoloFirmForUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data: membership } = await supabase
    .from("firm_members")
    .select("firm_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return true;

  const { count } = await supabase
    .from("firm_members")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", membership.firm_id)
    .eq("status", "active");

  return !count || count <= 1;
}

export type WorkspaceTeamContext = {
  isSoloFirm: boolean;
  /** user_id -> display_name (may be null if the teammate never set one). Empty when solo. */
  teammateNames: Record<string, string | null>;
};

/**
 * Server-side check for Beacon_Team_Multitenancy_Plan.md §7.3: the scope
 * toggle renders iff the broker's active firm has more than one active
 * member — computed here, once, and passed down as a prop, never inferred
 * client-side (no flash, no extra round-trip for the overwhelmingly common
 * solo case). Also returns the teammate display-name map for §7.4's
 * ownership indicator, via the narrow firm_teammate_names() RPC.
 */
export async function getWorkspaceTeamContext(supabase: SupabaseClient, userId: string): Promise<WorkspaceTeamContext> {
  const { data: membership } = await supabase
    .from("firm_members")
    .select("firm_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) return { isSoloFirm: true, teammateNames: {} };

  const { count } = await supabase
    .from("firm_members")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", membership.firm_id)
    .eq("status", "active");

  if (!count || count <= 1) return { isSoloFirm: true, teammateNames: {} };

  const { data: rows } = await supabase.rpc("firm_teammate_names");
  const teammateNames: Record<string, string | null> = {};
  for (const row of (rows ?? []) as { user_id: string; display_name: string | null }[]) {
    teammateNames[row.user_id] = row.display_name;
  }

  return { isSoloFirm: false, teammateNames };
}
