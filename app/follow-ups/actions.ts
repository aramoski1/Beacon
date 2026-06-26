"use server";

import { createClient } from "@/lib/supabase/server";

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
  property_address: string | null;
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
  contacts: unknown;
  properties: unknown;
}): FollowUpRow {
  return {
    id:               row.id,
    contact_id:       row.contact_id,
    property_id:      row.property_id,
    due_date:         row.due_date,
    description:      row.description,
    done:             row.done,
    done_at:          row.done_at,
    created_at:       row.created_at,
    contact_name:     (row.contacts as { name: string | null } | null)?.name ?? null,
    property_address: (row.properties as { address: string | null } | null)?.address ?? null,
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
      "id, contact_id, property_id, due_date, description, done, done_at, created_at, contacts(name), properties(address)"
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
      "id, contact_id, property_id, due_date, description, done, done_at, created_at, contacts(name), properties(address)"
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
      "id, contact_id, property_id, due_date, description, done, done_at, created_at, contacts(name), properties(address)"
    )
    .eq("owner_id", user.id)
    .eq("done", false)
    .gt("due_date", today)
    .order("due_date", { ascending: true })
    .limit(limit);

  return (data ?? []).map(mapRow);
}
