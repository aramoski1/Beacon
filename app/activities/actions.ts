"use server";

import { createClient } from "@/lib/supabase/server";
import { shouldBumpLastContacted, type TouchActivityType } from "@/lib/activity-touch";

export type ActivityType = "letter" | "email" | "call" | "note" | "meeting";

const VALID_ACTIVITY_TYPES: ActivityType[] = ["letter", "email", "call", "note", "meeting"];

export type Activity = {
  id: string;
  contact_id: string | null;
  property_id: string | null;
  activity_type: ActivityType;
  activity_date: string;
  notes: string | null;
  created_at: string;
};

export async function createActivity(params: {
  contact_id?: string | null;
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

  if (!VALID_ACTIVITY_TYPES.includes(params.activity_type)) {
    return { error: "Invalid activity type." };
  }

  // Must link to at least a contact or a property
  if (!params.contact_id && !params.property_id) {
    return { error: "An activity must be linked to a contact, a property, or both." };
  }

  // Verify contact belongs to this user (when provided)
  if (params.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", params.contact_id)
      .eq("owner_id", user.id)
      .single();
    if (!contact) return { error: "Contact not found." };
  }

  // Verify property belongs to this user (when provided)
  if (params.property_id) {
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("id", params.property_id)
      .eq("owner_id", user.id)
      .single();
    if (!property) return { error: "Property not found." };
  }

  const activityDate = params.activity_date ?? new Date().toISOString();

  const { data, error } = await supabase
    .from("activities")
    .insert({
      owner_id: user.id,
      contact_id: params.contact_id ?? null,
      property_id: params.property_id ?? null,
      activity_type: params.activity_type,
      activity_date: activityDate,
      notes: params.notes ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (
    params.contact_id &&
    shouldBumpLastContacted(params.activity_type as TouchActivityType)
  ) {
    await supabase
      .from("contacts")
      .update({ last_contacted_at: activityDate })
      .eq("id", params.contact_id)
      .eq("owner_id", user.id);
  }

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
