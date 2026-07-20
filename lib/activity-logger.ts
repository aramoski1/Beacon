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
  await supabase.from("activities").insert({
    owner_id: userId,
    contact_id: input.contact_id,
    property_id: input.property_id ?? null,
    activity_type: input.activity_type,
    activity_date: input.activity_date ?? new Date().toISOString(),
    notes: input.notes ?? null,
  });
}
