"use server";

import { createClient } from "@/lib/supabase/server";

// ─── Shared admin guard ─────────────────────────────────────────────────────────
//
// Defense in depth: RLS (is_admin() on approved_emails/access_requests) and
// admin_list_accounts()'s own internal is_admin() check are the real
// security boundary — a non-admin's request can never see another row or
// account regardless of this check. This just gives every action a clean,
// consistent "Not authorized." error instead of a confusing empty result.

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function requireAdmin(
  supabase: Supabase,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data } = await supabase
    .from("user_settings")
    .select("is_admin")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!data?.is_admin) return { ok: false, error: "Not authorized." };
  return { ok: true, userId: user.id };
}

// ─── Approved emails ────────────────────────────────────────────────────────────

export type ApprovedEmail = {
  id: string;
  email: string;
  createdAt: string;
};

export async function getApprovedEmails(): Promise<ApprovedEmail[] | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  const { data, error } = await supabase
    .from("approved_emails")
    .select("id, email, created_at")
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };
  return (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    createdAt: row.created_at as string,
  }));
}

export async function addApprovedEmail(
  rawEmail: string,
): Promise<{ ok: true; entry: ApprovedEmail } | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };

  const { data, error } = await supabase
    .from("approved_emails")
    .insert({ email, added_by: gate.userId })
    .select("id, email, created_at")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "That email is already approved." };
    return { error: error.message };
  }
  return { ok: true, entry: { id: data.id as string, email: data.email as string, createdAt: data.created_at as string } };
}

export async function removeApprovedEmail(id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  const { error } = await supabase.from("approved_emails").delete().eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ─── Access requests ──────────────────────────────────────────────────────────

export type AccessRequest = {
  id: string;
  email: string;
  requestedAt: string;
};

export async function getPendingAccessRequests(): Promise<AccessRequest[] | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  const { data, error } = await supabase
    .from("access_requests")
    .select("id, email, requested_at")
    .is("reviewed_at", null)
    .order("requested_at", { ascending: false });

  if (error) return { error: error.message };
  return (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    requestedAt: row.requested_at as string,
  }));
}

/** Approves the request's email (adds it to approved_emails) and marks the request reviewed. */
export async function approveAccessRequest(
  id: string,
  email: string,
): Promise<{ ok: true; entry: ApprovedEmail | null } | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  const normalized = email.trim().toLowerCase();
  const { data: inserted, error: insertError } = await supabase
    .from("approved_emails")
    .insert({ email: normalized, added_by: gate.userId })
    .select("id, email, created_at")
    .single();
  // 23505 (unique violation) means it was already approved — not a failure,
  // just nothing new to hand back to the caller.
  if (insertError && insertError.code !== "23505") return { error: insertError.message };

  const { error: reviewError } = await supabase
    .from("access_requests")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (reviewError) return { error: reviewError.message };

  const entry = inserted
    ? { id: inserted.id as string, email: inserted.email as string, createdAt: inserted.created_at as string }
    : null;
  return { ok: true, entry };
}

export async function dismissAccessRequest(id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  const { error } = await supabase
    .from("access_requests")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ─── Accounts ─────────────────────────────────────────────────────────────────
//
// admin_list_accounts() is a SECURITY DEFINER function (only way to read
// auth.users at all — RLS can never expose other users' rows) that
// re-checks is_admin() internally and returns zero rows for anyone else, so
// this never depends solely on the requireAdmin() check above for its real
// security. It surfaces identity only — email/signup date/name/firm — never
// properties/contacts/deals content.

export type AdminAccount = {
  userId: string;
  email: string;
  createdAt: string;
  displayName: string | null;
  company: string | null;
  firmName: string | null;
  accessRevokedAt: string | null;
  lastActiveAt: string | null;
};

export async function getAllAccounts(): Promise<AdminAccount[] | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  const { data, error } = await supabase.rpc("admin_list_accounts");
  if (error) return { error: error.message };

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    userId: row.user_id as string,
    email: row.email as string,
    createdAt: row.created_at as string,
    displayName: (row.display_name as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    firmName: (row.firm_name as string | null) ?? null,
    accessRevokedAt: (row.access_revoked_at as string | null) ?? null,
    lastActiveAt: (row.last_active_at as string | null) ?? null,
  }));
}

// ─── Revoke / restore access ────────────────────────────────────────────────────
//
// admin_set_account_revoked() is SECURITY DEFINER and re-checks is_admin()
// internally (same shape as admin_list_accounts()), and also rejects a
// self-target there — the checks here are the same clean-error convenience
// layer as requireAdmin() everywhere else in this file, not the real
// boundary. This is an app-level soft block (no Supabase Auth ban, no
// service-role key) — see scripts/migrate-admin-account-management.ts and
// lib/auth-require-user.ts for where it's actually enforced.

export async function revokeAccountAccess(userId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };
  if (gate.userId === userId) return { error: "You cannot revoke your own access." };

  const { error } = await supabase.rpc("admin_set_account_revoked", { target_user: userId, revoked: true });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function restoreAccountAccess(userId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  const { error } = await supabase.rpc("admin_set_account_revoked", { target_user: userId, revoked: false });
  if (error) return { error: error.message };
  return { ok: true };
}

// ─── Per-account activity ───────────────────────────────────────────────────────

export type ActivityEntry = {
  id: string;
  path: string;
  method: string;
  createdAt: string;
};

const ACTIVITY_PAGE_SIZE = 50;

export async function getAccountActivity(
  userId: string,
  before?: string,
): Promise<ActivityEntry[] | { error: string }> {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return { error: gate.error };

  let query = supabase
    .from("activity_log")
    .select("id, path, method, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE);
  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) return { error: error.message };
  return (data ?? []).map((row) => ({
    id: row.id as string,
    path: row.path as string,
    method: row.method as string,
    createdAt: row.created_at as string,
  }));
}
