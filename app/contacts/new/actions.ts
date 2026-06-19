"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function createContact(
  formData: FormData
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Name is required." };

  const tierRaw = formData.get("contact_tier") as string | null;
  const contact_tier = tierRaw ? Number(tierRaw) : null;

  // Collect custom fields — any key starting with "cf_"
  const custom_fields: Record<string, string | null> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("cf_")) {
      const slug = key.slice(3);
      custom_fields[slug] = (value as string).trim() || null;
    }
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      owner_id: user.id,
      name,
      email: (formData.get("email") as string | null)?.trim() || null,
      phone: (formData.get("phone") as string | null)?.trim() || null,
      company: (formData.get("company") as string | null)?.trim() || null,
      role: (formData.get("role") as string | null)?.trim() || null,
      contact_tier,
      client_status: (formData.get("client_status") as string | null) || null,
      action_tags: [],
      outreach_history: [],
      custom_fields,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}
