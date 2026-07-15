"use server";

import { createClient } from "@/lib/supabase/server";

export type ContactRow = {
  id: string;
  name: string | null;
  company: string | null;
  contact_tier: number | null;
  relationship_stage: string | null;
  client_status: string | null;
  linked_properties: string[] | null;
  last_contacted_at: string | null;
};

export async function getContacts(): Promise<ContactRow[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("contacts")
    .select("id, name, company, contact_tier, relationship_stage, client_status, linked_properties, last_contacted_at")
    .eq("owner_id", user.id)
    .order("name", { ascending: true });

  return (data ?? []) as ContactRow[];
}
