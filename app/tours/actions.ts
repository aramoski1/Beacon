"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withAction } from "@/lib/logger";

export type TourRow = {
  id: string;
  scheduled_at: string;
  property_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  attendees: string | null;
  status: "scheduled" | "completed" | "cancelled";
  notes: string | null;
  post_tour_notes: string | null;
  properties: { address: string | null } | null;
  contacts: { name: string | null } | null;
};

export async function listTours(): Promise<TourRow[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("tours")
    .select("id, scheduled_at, property_id, contact_id, deal_id, attendees, status, notes, post_tour_notes, properties(address), contacts(name)")
    .eq("owner_id", user.id)
    .order("scheduled_at", { ascending: true })
    .limit(100);
  return (data ?? []) as unknown as TourRow[];
}

export async function createTour(input: {
  scheduledAt: string;
  propertyId?: string | null;
  contactId?: string | null;
  attendees?: string | null;
  notes?: string | null;
}): Promise<{ error?: string }> {
  return withAction("createTour", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated." };
    if (!input.scheduledAt) return { error: "Pick a date and time." };
    const { error } = await supabase.from("tours").insert({
      owner_id: user.id,
      scheduled_at: input.scheduledAt,
      property_id: input.propertyId || null,
      contact_id: input.contactId || null,
      attendees: input.attendees || null,
      notes: input.notes || null,
    });
    if (error) return { error: error.message };
    revalidatePath("/tours");
    return {};
  });
}

export async function updateTourStatus(
  id: string,
  status: TourRow["status"],
  postTourNotes?: string | null,
): Promise<{ error?: string }> {
  return withAction("updateTourStatus", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated." };
    const { error } = await supabase
      .from("tours")
      .update({
        status,
        post_tour_notes: postTourNotes ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) return { error: error.message };
    revalidatePath("/tours");
    return {};
  });
}
