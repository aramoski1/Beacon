"use server";

import { createClient } from "@/lib/supabase/server";

export type InvitationPreview = {
  firmName: string | null;
  role: "owner" | "admin" | "member";
  email: string;
};

/**
 * Only ever returns a row if the CURRENT authenticated user's own email
 * matches the invitation (firm_invitations_invitee_select RLS) — an
 * anonymous visitor, or one signed in under a different email, gets null,
 * not a peek at someone else's pending invite.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("firm_invitations")
    .select("role, email, firm_id, accepted_at, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  if (data.accepted_at || data.revoked_at || new Date(data.expires_at) < new Date()) return null;

  const { data: firm } = await supabase.from("firms").select("name").eq("id", data.firm_id).maybeSingle();
  return { firmName: firm?.name ?? null, role: data.role, email: data.email };
}

export async function acceptInvitation(token: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("redeem_firm_invitation", { p_token: token });
  if (error) return { error: error.message.includes("Invalid, expired") ? "This invitation link is no longer valid." : error.message };
  return {};
}
