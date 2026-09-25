"use server";

import { createClient } from "@/lib/supabase/server";
import { shouldBumpLastContacted, type TouchActivityType } from "@/lib/activity-touch";
import { contactIdsForProperty } from "@/lib/contact-properties";
import { jevRefineActivityType } from "@/lib/jev-activity";
import {
  isPropertyActivityField,
  mergePropertyActivityPatch,
  resolveGridActivityPayload,
} from "@/lib/property-grid-activity";

export type ActivityType = "letter" | "email" | "call" | "note" | "meeting";

const VALID_ACTIVITY_TYPES: ActivityType[] = ["letter", "email", "call", "note", "meeting"];

export type Activity = {
  id: string;
  contact_id: string | null;
  property_id: string | null;
  deal_id: string | null;
  activity_type: ActivityType;
  activity_date: string;
  notes: string | null;
  created_at: string;
};

export async function createActivity(params: {
  contact_id?: string | null;
  property_id?: string | null;
  deal_id?: string | null;
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

  // Must link to at least a contact, a property, or a deal
  if (!params.contact_id && !params.property_id && !params.deal_id) {
    return { error: "An activity must be linked to a contact, a property, or a deal." };
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

  // Verify deal belongs to this user (when provided)
  if (params.deal_id) {
    const { data: deal } = await supabase
      .from("deals")
      .select("id")
      .eq("id", params.deal_id)
      .eq("owner_id", user.id)
      .single();
    if (!deal) return { error: "Deal not found." };
  }

  const activityDate = params.activity_date ?? new Date().toISOString();
  const activityType = await jevRefineActivityType(params.activity_type, params.notes);

  const { data, error } = await supabase
    .from("activities")
    .insert({
      owner_id: user.id,
      contact_id: params.contact_id ?? null,
      property_id: params.property_id ?? null,
      deal_id: params.deal_id ?? null,
      activity_type: activityType,
      activity_date: activityDate,
      notes: params.notes ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (
    params.contact_id &&
    shouldBumpLastContacted(activityType as TouchActivityType)
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
    .select("id, contact_id, property_id, deal_id, activity_type, activity_date, notes, created_at")
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
    .select("id, contact_id, property_id, deal_id, activity_type, activity_date, notes, created_at")
    .eq("owner_id", user.id)
    .eq("property_id", propertyId)
    .order("activity_date", { ascending: false });

  return (data ?? []) as Activity[];
}

export async function fetchActivitiesByDeal(dealId: string): Promise<Activity[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("activities")
    .select("id, contact_id, property_id, deal_id, activity_type, activity_date, notes, created_at")
    .eq("owner_id", user.id)
    .eq("deal_id", dealId)
    .order("activity_date", { ascending: false });

  return (data ?? []) as Activity[];
}

/**
 * Workspace property-grid activity edit: mirrors denormalized columns AND
 * creates/updates a real activities row; bumps linked CRM contact cadence when appropriate.
 */
export async function savePropertyGridActivity(params: {
  propertyId: string;
  field: string;
  value: unknown;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (!isPropertyActivityField(params.field)) {
    return { error: "Not an activity field." };
  }

  const { data: prop, error: loadErr } = await supabase
    .from("properties")
    .select("id, last_activity_date, last_activity_type, last_activity_notes")
    .eq("id", params.propertyId)
    .eq("owner_id", user.id)
    .single();
  if (loadErr || !prop) return { error: loadErr?.message ?? "Property not found." };

  const merged = mergePropertyActivityPatch(
    {
      last_activity_date: prop.last_activity_date ?? null,
      last_activity_type: prop.last_activity_type ?? null,
      last_activity_notes: prop.last_activity_notes ?? null,
    },
    params.field,
    params.value,
  );

  const { error: updErr } = await supabase
    .from("properties")
    .update({
      last_activity_date: merged.last_activity_date,
      last_activity_type: merged.last_activity_type,
      last_activity_notes: merged.last_activity_notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.propertyId)
    .eq("owner_id", user.id);
  if (updErr) return { error: updErr.message };

  const payload = resolveGridActivityPayload(merged);
  let contactId: string | null = null;
  try {
    const ids = await contactIdsForProperty(supabase, user.id, params.propertyId);
    contactId = ids[0] ?? null;
  } catch {
    contactId = null;
  }

  const { data: latest } = await supabase
    .from("activities")
    .select("id")
    .eq("owner_id", user.id)
    .eq("property_id", params.propertyId)
    .order("activity_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.id) {
    const { error } = await supabase
      .from("activities")
      .update({
        activity_type: payload.activity_type,
        activity_date: payload.activity_date,
        notes: payload.notes,
        contact_id: contactId,
      })
      .eq("id", latest.id)
      .eq("owner_id", user.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("activities").insert({
      owner_id: user.id,
      property_id: params.propertyId,
      contact_id: contactId,
      activity_type: payload.activity_type,
      activity_date: payload.activity_date,
      notes: payload.notes,
    });
    if (error) return { error: error.message };
  }

  if (contactId && shouldBumpLastContacted(payload.activity_type)) {
    await supabase
      .from("contacts")
      .update({ last_contacted_at: payload.activity_date })
      .eq("id", contactId)
      .eq("owner_id", user.id);
  }

  return {};
}
