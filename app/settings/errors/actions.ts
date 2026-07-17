"use server";

import { createClient } from "@/lib/supabase/server";
import type { ErrorLogRow } from "@/lib/logger";

const PAGE_SIZE = 30;

export type ErrorLogsPage = {
  rows: ErrorLogRow[];
  total: number;
};

export async function getErrorLogs(
  filter: "unresolved" | "all" = "unresolved",
  page = 0
): Promise<ErrorLogsPage | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const from = page * PAGE_SIZE;
  let query = supabase
    .from("error_logs")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .order("occurred_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (filter === "unresolved") {
    query = query.is("resolved_at", null);
  }

  const { data, count, error } = await query;
  if (error) return { error: error.message };
  return { rows: (data ?? []) as ErrorLogRow[], total: count ?? 0 };
}

export async function resolveErrorLog(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("error_logs")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id);

  return error ? { error: error.message } : {};
}

export async function dismissErrorLog(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("error_logs")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  return error ? { error: error.message } : {};
}

export async function dismissAllErrorLogs(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("error_logs")
    .delete()
    .eq("owner_id", user.id);

  return error ? { error: error.message } : {};
}

export async function resolveAllErrorLogs(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("error_logs")
    .update({ resolved_at: now })
    .eq("owner_id", user.id)
    .is("resolved_at", null);

  return error ? { error: error.message } : {};
}
