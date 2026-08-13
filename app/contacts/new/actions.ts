"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { validateName, validateEmail } from "@/lib/validation";
import { linkContactPropertyAndSync } from "@/lib/contact-properties";

export async function createContact(
  formData: FormData
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = (formData.get("name") as string | null)?.trim();
  const nameErr = validateName(name);
  if (nameErr) return { error: nameErr.message };

  const str = (key: string) =>
    (formData.get(key) as string | null)?.trim() || null;

  const emailRaw = str("email");
  const emailErr = validateEmail(emailRaw);
  if (emailErr) return { error: emailErr.message };

  const dateStr = (key: string) => {
    const v = str(key);
    return v ? new Date(v).toISOString() : null;
  };

  const tierRaw = formData.get("contact_tier") as string | null;
  const contact_tier = tierRaw ? Number(tierRaw) : null;

  const linkedPropId = str("linked_properties");
  const linked_properties = linkedPropId ? [linkedPropId] : [];

  const asset_focus = (formData.getAll("asset_focus") as string[]).filter(Boolean);

  const tagsRaw = str("tags");
  const action_tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const custom_fields: Record<string, string | null> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("cf_")) {
      custom_fields[key.slice(3)] = (value as string).trim() || null;
    }
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      owner_id:           user.id,
      name,
      company:            str("company"),
      title_role:         str("title_role"),
      email:              str("email"),
      phone_mobile:       str("phone_mobile"),
      phone_office:       str("phone_office"),
      mailing_address:    str("mailing_address"),
      ownership_role:     str("ownership_role"),
      asset_focus,
      submarket:          str("submarket"),
      portfolio_size:     str("portfolio_size"),
      contact_tier,
      relationship_stage: str("relationship_stage"),
      lead_source:        str("lead_source"),
      last_contacted_at:  dateStr("last_contacted_at"),
      next_action_due:    dateStr("next_action_due"),
      notes:              str("notes"),
      linked_properties,
      action_tags,
      outreach_history:   [],
      custom_fields,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  if (linkedPropId) {
    try {
      await linkContactPropertyAndSync(supabase, user.id, data.id, linkedPropId);
    } catch {
      // Contact exists; join sync is best-effort (array already set on insert).
    }
  }
  return { id: data.id };
}

/** Lightweight contact list for type-to-search pickers (link-existing-contact flows). */
export async function getAllContactsForPicker(): Promise<
  { id: string; name: string | null; company: string | null }[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("contacts")
    .select("id, name, company")
    .eq("owner_id", user.id)
    .order("name", { ascending: true })
    .limit(1000);
  return (data ?? []) as { id: string; name: string | null; company: string | null }[];
}
