"use server";

import { createClient } from "@/lib/supabase/server";
import type { IngestionErrorRow } from "@/lib/ingestion-logger";

const PAGE_SIZE = 50;

export type ErrorsPage = {
  rows: IngestionErrorRow[];
  total: number;
};

export async function getIngestionErrors(page = 0): Promise<ErrorsPage | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const from = page * PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("ingestion_errors")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .order("occurred_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) return { error: error.message };
  return { rows: (data ?? []) as IngestionErrorRow[], total: count ?? 0 };
}

export async function dismissError(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("ingestion_errors")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  return error ? { error: error.message } : {};
}

export async function dismissAllErrors(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("ingestion_errors")
    .delete()
    .eq("owner_id", user.id);

  return error ? { error: error.message } : {};
}
