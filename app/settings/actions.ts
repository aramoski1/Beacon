"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type UserSettings = {
  display_name: string | null;
  broker_name: string | null;
  company: string | null;
  license_number: string | null;
  default_market: string | null;
  default_submarket: string | null;
  phone: string | null;
  website: string | null;
  email_signature: string | null;
  sender_name: string | null;
  sender_email: string | null;
  cadence_tier1_days: number;
  cadence_tier2_days: number;
  cadence_tier3_days: number;
  costar_enabled: boolean;
  onboarding_completed_at: string | null;
  email_provider: string | null;
};

const DEFAULTS: UserSettings = {
  display_name: null,
  broker_name: null,
  company: null,
  license_number: null,
  default_market: null,
  default_submarket: null,
  phone: null,
  website: null,
  email_signature: null,
  sender_name: null,
  sender_email: null,
  cadence_tier1_days: 14,
  cadence_tier2_days: 30,
  cadence_tier3_days: 90,
  costar_enabled: true,
  onboarding_completed_at: null,
  email_provider: null,
};

export async function getUserSettings(): Promise<UserSettings> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("user_settings")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!data) return DEFAULTS;
  return { ...DEFAULTS, ...data } as UserSettings;
}

export async function upsertUserSettings(
  partial: Partial<UserSettings>
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { owner_id: user.id, ...partial, updated_at: new Date().toISOString() },
      { onConflict: "owner_id" }
    );

  if (error) return { error: error.message };
  return {};
}

export async function changePassword(
  newPassword: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return {};
}

export async function deleteAllData(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const tables = [
    "follow_ups",
    "activities",
    "ingestion_errors",
    "smart_lists",
    "lease_abstracts",
    "contacts",
    "properties",
    "field_definitions",
    "user_settings",
  ];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("owner_id", user.id);
    if (error) return { error: `Failed to delete ${table}: ${error.message}` };
  }

  return {};
}

export async function getIngestionErrorCount(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count } = await supabase
    .from("ingestion_errors")
    .select("*", { count: "exact", head: true })
    .eq("owner_id", user.id);

  return count ?? 0;
}
