"use server";

import { createClient } from "@/lib/supabase/server";
import { validateRequiredDate } from "@/lib/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FollowUpRow = {
  id: string;
  contact_id: string | null;
  property_id: string | null;
  due_date: string;       // 'YYYY-MM-DD'
  description: string;
  done: boolean;
  done_at: string | null;
  created_at: string;
  contact_name: string | null;
  contact_email: string | null;
  property_address: string | null;
  source_type: string;    // 'manual' | 'lease_expiry'
  lease_id: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapRow(row: {
  id: string;
  contact_id: string | null;
  property_id: string | null;
  due_date: string;
  description: string;
  done: boolean;
  done_at: string | null;
  created_at: string;
  source_type: string | null;
  lease_id: string | null;
  contacts: unknown;
  properties: unknown;
}): FollowUpRow {
  const contact = row.contacts as { name: string | null; email: string | null } | null;
  return {
    id:               row.id,
    contact_id:       row.contact_id,
    property_id:      row.property_id,
    due_date:         row.due_date,
    description:      row.description,
    done:             row.done,
    done_at:          row.done_at,
    created_at:       row.created_at,
    contact_name:     contact?.name  ?? null,
    contact_email:    contact?.email ?? null,
    property_address: (row.properties as { address: string | null } | null)?.address ?? null,
    source_type:      row.source_type ?? "manual",
    lease_id:         row.lease_id,
  };
}

export async function listFollowUpLinkOptions(): Promise<{
  contacts: { id: string; name: string | null }[];
  properties: { id: string; address: string | null }[];
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { contacts: [], properties: [] };

  const [contactsRes, propsRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name")
      .eq("owner_id", user.id)
      .order("name", { ascending: true })
      .limit(200),
    supabase
      .from("properties")
      .select("id, address")
      .eq("owner_id", user.id)
      .order("address", { ascending: true })
      .limit(200),
  ]);

  return {
    contacts: contactsRes.data ?? [],
    properties: propsRes.data ?? [],
  };
}

// ─── createFollowUp ───────────────────────────────────────────────────────────

export async function createFollowUp(params: {
  contact_id?: string | null;
  property_id?: string | null;
  due_date: string;           // 'YYYY-MM-DD'
  description?: string;
}): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const dateErr = validateRequiredDate(params.due_date, "due_date");
  if (dateErr) return { error: dateErr.message };

  const { data, error } = await supabase
    .from("follow_ups")
    .insert({
      owner_id:    user.id,
      contact_id:  params.contact_id  ?? null,
      property_id: params.property_id ?? null,
      due_date:    params.due_date,
      description: params.description ?? "Follow up",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Keep contact.next_action_due in sync
  if (params.contact_id) {
    await supabase
      .from("contacts")
      .update({
        next_action_due: new Date(params.due_date).toISOString(),
        updated_at:      new Date().toISOString(),
      })
      .eq("id", params.contact_id)
      .eq("owner_id", user.id);
  }

  return { id: data.id };
}

// ─── markFollowUpDone ─────────────────────────────────────────────────────────

export async function markFollowUpDone(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("follow_ups")
    .update({ done: true, done_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id);

  return error ? { error: error.message } : {};
}

// ─── getFollowUps ─────────────────────────────────────────────────────────────

export async function getFollowUps(
  filter: "open" | "done" | "all" = "open"
): Promise<FollowUpRow[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from("follow_ups")
    .select(
      "id, contact_id, property_id, due_date, description, done, done_at, created_at, source_type, lease_id, contacts(name, email), properties(address)"
    )
    .eq("owner_id", user.id)
    .order("due_date", { ascending: true });

  if (filter === "open") query = query.eq("done", false);
  if (filter === "done") query = query.eq("done", true).order("done_at", { ascending: false });

  const { data } = await query;
  return (data ?? []).map(mapRow);
}

// ─── getFollowUpsDashboard ────────────────────────────────────────────────────

export async function getFollowUpsDashboard(): Promise<{
  overdue: FollowUpRow[];
  today:   FollowUpRow[];
  dueCount: number;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { overdue: [], today: [], dueCount: 0 };

  const today = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from("follow_ups")
    .select(
      "id, contact_id, property_id, due_date, description, done, done_at, created_at, source_type, lease_id, contacts(name, email), properties(address)"
    )
    .eq("owner_id", user.id)
    .eq("done", false)
    .lte("due_date", today)
    .order("due_date", { ascending: true })
    .limit(20);

  const rows = (data ?? []).map(mapRow);
  const overdue = rows.filter((r) => r.due_date < today);
  const todayRows = rows.filter((r) => r.due_date === today);

  return { overdue, today: todayRows, dueCount: rows.length };
}

/** Open follow-ups due after today — for dashboard upcoming section. */
export async function getUpcomingFollowUps(limit = 8): Promise<FollowUpRow[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const today = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from("follow_ups")
    .select(
      "id, contact_id, property_id, due_date, description, done, done_at, created_at, source_type, lease_id, contacts(name, email), properties(address)"
    )
    .eq("owner_id", user.id)
    .eq("done", false)
    .gt("due_date", today)
    .order("due_date", { ascending: true })
    .limit(limit);

  return (data ?? []).map(mapRow);
}
