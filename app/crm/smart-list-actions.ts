"use server";

import { createClient } from "@/lib/supabase/server";
import type { SearchResult } from "./actions";
import type { SmartListCounts } from "@/lib/crm-search-filters";
import {
  countSmartListMatches,
  fetchSmartListContactIds,
} from "@/lib/crm-search-apply-server";

export type SmartListEntity = "properties" | "contacts" | "leases";

export type SmartList = {
  id: string;
  name: string;
  query_text: string;
  filters: SearchResult;
  entity_type: SmartListEntity;
  created_at: string;
  updated_at: string;
};

export type SmartListWithCounts = SmartList & { counts: SmartListCounts };

export async function listSmartLists(
  entityType: SmartListEntity,
): Promise<SmartListWithCounts[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("smart_lists")
    .select("id, name, query_text, filters, entity_type, created_at, updated_at")
    .eq("owner_id", user.id)
    .eq("entity_type", entityType)
    .order("updated_at", { ascending: false });

  if (error) {
    if (error.message.includes("smart_lists") || error.code === "42P01") {
      return [];
    }
    throw new Error(error.message);
  }

  const lists = (data ?? []) as SmartList[];
  const withCounts = await Promise.all(
    lists.map(async (list) => ({
      ...list,
      filters: list.filters as SearchResult,
      counts: await countSmartListMatches(list.filters as SearchResult, user.id),
    })),
  );
  return withCounts;
}

export async function saveSmartList(
  queryText: string,
  filters: SearchResult,
  entityType: SmartListEntity,
  name?: string,
): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const trimmed = queryText.trim();
  if (!trimmed) return { error: "Query text is required." };

  const listName = (name?.trim() || filters.explanation || trimmed).slice(0, 120);

  const filtersPayload = JSON.parse(JSON.stringify(filters)) as SearchResult;

  const { data, error } = await supabase
    .from("smart_lists")
    .insert({
      owner_id: user.id,
      name: listName,
      query_text: trimmed,
      filters: filtersPayload,
      entity_type: entityType,
    })
    .select("id")
    .single();

  if (error) {
    if (error.message.includes("smart_lists") || error.code === "42P01") {
      return { error: "Smart lists table not found. Run npm run migrate first." };
    }
    return { error: error.message };
  }
  return { id: data.id };
}

export async function deleteSmartList(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("smart_lists")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  return {};
}

export async function getSmartListContactIdsForOutreach(
  filters: SearchResult,
): Promise<{ contactIds: string[]; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { contactIds: [], error: "Not authenticated." };

  const contactIds = await fetchSmartListContactIds(filters, user.id);
  return { contactIds };
}

export async function refreshSmartListCounts(
  filters: SearchResult,
): Promise<SmartListCounts | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return countSmartListMatches(filters, user.id);
}
