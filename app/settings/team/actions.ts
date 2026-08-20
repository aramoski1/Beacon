"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TeamRole = "owner" | "admin" | "member";

export type TeamMember = {
  id: string;
  userId: string;
  role: TeamRole;
  displayName: string | null;
  isMe: boolean;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: TeamRole;
  expiresAt: string;
  createdAt: string;
};

export type TeamData = {
  firmId: string | null;
  firmName: string | null;
  myRole: TeamRole | null;
  isSoloFirm: boolean;
  members: TeamMember[];
  pendingInvitations: PendingInvitation[];
};

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function getTeamData(): Promise<TeamData> {
  const { supabase, user } = await requireUser();
  if (!user) return { firmId: null, firmName: null, myRole: null, isSoloFirm: true, members: [], pendingInvitations: [] };

  const { data: myMembership } = await supabase
    .from("firm_members")
    .select("firm_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!myMembership) return { firmId: null, firmName: null, myRole: null, isSoloFirm: true, members: [], pendingInvitations: [] };

  const [{ data: firm }, { data: memberRows }, { data: nameRows }, { data: invitationRows }] = await Promise.all([
    supabase.from("firms").select("id, name").eq("id", myMembership.firm_id).maybeSingle(),
    supabase
      .from("firm_members")
      .select("id, user_id, role")
      .eq("firm_id", myMembership.firm_id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase.rpc("firm_teammate_names"),
    myMembership.role === "owner" || myMembership.role === "admin"
      ? supabase
          .from("firm_invitations")
          .select("id, email, role, expires_at, created_at")
          .eq("firm_id", myMembership.firm_id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: TeamRole; expires_at: string; created_at: string }[] }),
  ]);

  const nameByUserId = new Map<string, string | null>(
    ((nameRows ?? []) as { user_id: string; display_name: string | null }[]).map((r) => [r.user_id, r.display_name]),
  );

  const members: TeamMember[] = ((memberRows ?? []) as { id: string; user_id: string; role: TeamRole }[]).map((m) => ({
    id: m.id,
    userId: m.user_id,
    role: m.role,
    displayName: nameByUserId.get(m.user_id) ?? null,
    isMe: m.user_id === user.id,
  }));

  const pendingInvitations: PendingInvitation[] = (
    (invitationRows ?? []) as { id: string; email: string; role: TeamRole; expires_at: string; created_at: string }[]
  ).map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at, createdAt: i.created_at }));

  return {
    firmId: myMembership.firm_id,
    firmName: firm?.name ?? null,
    myRole: myMembership.role,
    isSoloFirm: members.length <= 1,
    members,
    pendingInvitations,
  };
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function inviteTeammate(formData: FormData): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Not authenticated." };

  const email = (formData.get("email") as string | null)?.trim().toLowerCase() ?? "";
  const role = formData.get("role") as TeamRole;

  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  if (role !== "admin" && role !== "member") return { error: "Invalid role." };

  const { data: myMembership } = await supabase
    .from("firm_members")
    .select("firm_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!myMembership || (myMembership.role !== "owner" && myMembership.role !== "admin")) {
    return { error: "Only the firm's owner or an admin can invite teammates." };
  }

  const { error } = await supabase.from("firm_invitations").insert({
    firm_id: myMembership.firm_id,
    email,
    role,
    token: randomToken(),
    invited_by: user.id,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return {};
}

export async function revokeInvitation(invitationId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("firm_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return {};
}

export async function resendInvitation(invitationId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("firm_invitations")
    .update({ expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    .eq("id", invitationId);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return {};
}

export async function removeMember(memberRowId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Not authenticated." };

  const { data: myMembership } = await supabase
    .from("firm_members")
    .select("firm_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!myMembership || (myMembership.role !== "owner" && myMembership.role !== "admin")) {
    return { error: "Only the firm's owner or an admin can remove a teammate." };
  }

  const { data: target } = await supabase
    .from("firm_members")
    .select("id, user_id, role, firm_id")
    .eq("id", memberRowId)
    .maybeSingle();
  if (!target || target.firm_id !== myMembership.firm_id) return { error: "Member not found." };

  if (target.role === "owner") {
    return { error: "The firm's owner can't be removed this way — have them leave or transfer ownership first." };
  }

  const { error } = await supabase.from("firm_members").update({ status: "removed" }).eq("id", memberRowId);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return {};
}

export async function changeMemberRole(memberRowId: string, newRole: "admin" | "member"): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Not authenticated." };

  const { data: myMembership } = await supabase
    .from("firm_members")
    .select("firm_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!myMembership || myMembership.role !== "owner") {
    return { error: "Only the firm's owner can change a teammate's role." };
  }

  const { data: target } = await supabase
    .from("firm_members")
    .select("id, role, firm_id")
    .eq("id", memberRowId)
    .maybeSingle();
  if (!target || target.firm_id !== myMembership.firm_id) return { error: "Member not found." };
  if (target.role === "owner") return { error: "The firm's owner role can't be changed here." };

  const { error } = await supabase.from("firm_members").update({ role: newRole }).eq("id", memberRowId);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return {};
}

export async function leaveFirm(): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Not authenticated." };

  const { data: myMembership } = await supabase
    .from("firm_members")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!myMembership) return { error: "You're not an active member of any firm." };
  if (myMembership.role === "owner") {
    return { error: "The firm's owner can't leave — promote a teammate to owner first, or remove the other members." };
  }

  const { error } = await supabase.from("firm_members").update({ status: "removed" }).eq("id", myMembership.id);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return {};
}
