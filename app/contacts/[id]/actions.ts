"use server";

import { createClient } from "@/lib/supabase/server";

export async function setFollowUp(contactId: string, date: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("contacts")
    .update({ next_action_due: date, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("owner_id", user.id);

  return error ? { error: error.message } : {};
}
