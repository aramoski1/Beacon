import type { SupabaseClient } from "@supabase/supabase-js";

export type LogActivityInput = {
  contact_id?: string | null;
  property_id?: string | null;
  activity_type: "letter" | "email" | "call" | "note" | "meeting";
  activity_date?: string;
  notes?: string | null;
};

export async function logActivity(
  supabase: SupabaseClient,
  userId: string,
  input: LogActivityInput
): Promise<void> {
  const activityDate = input.activity_date ?? new Date().toISOString();
  await supabase.from("activities").insert({
    owner_id: userId,
    contact_id: input.contact_id,
    property_id: input.property_id ?? null,
    activity_type: input.activity_type,
    activity_date: activityDate,
    notes: input.notes ?? null,
  });

  if (input.contact_id) {
    await supabase
      .from("contacts")
      .update({ last_contacted_at: activityDate })
      .eq("id", input.contact_id)
      .eq("owner_id", userId);
  }
}
