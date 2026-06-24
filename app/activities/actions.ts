"use server";

import { createClient } from "@/lib/supabase/server";

export type ActivityType = "letter" | "email" | "call" | "note" | "meeting";

export type Activity = {
  id: string;
  contact_id: string;
  property_id: string | null;
  activity_type: ActivityType;
  activity_date: string;
  notes: string | null;
  created_at: string;
};

export async function createActivity(params: {
  contact_id: string;
  property_id?: string | null;
  activity_type: ActivityType;
  activity_date?: string | null;
  notes?: string | null;
}): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data, error } = await supabase
    .from("activities")
    .insert({
      owner_id: user.id,
      contact_id: params.contact_id,
      property_id: params.property_id ?? null,
      activity_type: params.activity_type,
      activity_date: params.activity_date ?? new Date().toISOString(),
      notes: params.notes ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

export async function fetchActivitiesByContact(contactId: string): Promise<Activity[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("activities")
    .select("id, contact_id, property_id, activity_type, activity_date, notes, created_at")
    .eq("owner_id", user.id)
    .eq("contact_id", contactId)
    .order("activity_date", { ascending: false });

  return (data ?? []) as Activity[];
}

export async function fetchActivitiesByProperty(propertyId: string): Promise<Activity[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("activities")
    .select("id, contact_id, property_id, activity_type, activity_date, notes, created_at")
    .eq("owner_id", user.id)
    .eq("property_id", propertyId)
    .order("activity_date", { ascending: false });

  return (data ?? []) as Activity[];
}
