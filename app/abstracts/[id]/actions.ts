"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setLeaseTenant(
  leaseId: string,
  contactId: string | null,
): Promise<{ error?: string; ok?: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("lease_abstracts")
    .update({ tenant_contact_id: contactId })
    .eq("id", leaseId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/abstracts/${leaseId}`);
  return { ok: true };
}
