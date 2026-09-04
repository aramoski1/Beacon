"use server";

import { createClient } from "@/lib/supabase/server";
import { listSmartLists } from "@/app/crm/smart-list-actions";
import { fetchSmartListContactIds } from "@/lib/crm-search-apply-server";
import { getDueContacts, type DueContact } from "@/app/outreach/actions";
import { buildContactOccupancy, type ContactOccupancy } from "@/lib/contact-occupancy";
import { propertyIdsByContactIds } from "@/lib/contact-properties";

export type WeeklyListContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  contact_type: string | null;
  contact_tier: number | null;
  last_contacted_at: string | null;
  occupancy: ContactOccupancy;
};

export type WeeklyListState = {
  contacts: WeeklyListContact[];
  smartListId: string | null;
  smartListName: string | null;
  target: number;
  source: "smart-list" | "cadence";
  lists: { id: string; name: string }[];
};

export async function getWeeklyList(): Promise<WeeklyListState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { contacts: [], smartListId: null, smartListName: null, target: 25, source: "cadence", lists: [] };
  }

  const [{ data: settings }, lists, due] = await Promise.all([
    supabase
      .from("user_settings")
      .select("weekly_list_smart_list_id, weekly_list_target")
      .eq("owner_id", user.id)
      .maybeSingle(),
    listSmartLists("contacts"),
    getDueContacts(),
  ]);

  const target = Math.min(100, Math.max(5, settings?.weekly_list_target ?? 25));
  const smartListId = (settings?.weekly_list_smart_list_id as string | null) ?? null;
  const pinned = lists.find((l) => l.id === smartListId) ?? null;

  let ids: string[] = [];
  let source: "smart-list" | "cadence" = "cadence";
  if (pinned) {
    ids = (await fetchSmartListContactIds(pinned.filters, user.id)).slice(0, target);
    source = "smart-list";
  }
  if (ids.length === 0) {
    ids = due.slice(0, target).map((c: DueContact) => c.id);
    source = pinned ? "smart-list" : "cadence";
    if (pinned && ids.length === 0) source = "cadence";
  }

  if (ids.length === 0) {
    return {
      contacts: [],
      smartListId: pinned?.id ?? null,
      smartListName: pinned?.name ?? null,
      target,
      source,
      lists: lists.map((l) => ({ id: l.id, name: l.name })),
    };
  }

  const { data: rows } = await supabase
    .from("contacts")
    .select("id, name, email, phone, phone_mobile, company, contact_type, contact_tier, last_contacted_at")
    .eq("owner_id", user.id)
    .in("id", ids);

  const byContact = await propertyIdsByContactIds(supabase, user.id, ids);
  const propIds = [...new Set(ids.flatMap((id) => byContact.get(id) ?? []))];
  const [{ data: props }, { data: leases }] = await Promise.all([
    propIds.length
      ? supabase
          .from("properties")
          .select("id, address, city, submarket, property_type, size_sqft, land_sqft, last_sale_date, last_sale_price, owner_name")
          .in("id", propIds)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("lease_abstracts")
      .select("id, tenant_contact_id, linked_property, expiration_date, leased_sf, landlord_name")
      .in("tenant_contact_id", ids),
  ]);

  const order = new Map(ids.map((id, i) => [id, i]));
  const contacts: WeeklyListContact[] = (rows ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: (c as { phone_mobile?: string | null }).phone_mobile?.trim() || c.phone,
      company: c.company,
      contact_type: c.contact_type,
      contact_tier: c.contact_tier,
      last_contacted_at: c.last_contacted_at,
      occupancy: buildContactOccupancy(
        byContact.get(c.id) ?? [],
        (props ?? []) as Parameters<typeof buildContactOccupancy>[1],
        (leases ?? []) as Parameters<typeof buildContactOccupancy>[2],
        c.id,
      ),
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    contacts,
    smartListId: pinned?.id ?? null,
    smartListName: pinned?.name ?? null,
    target,
    source: pinned && contacts.length > 0 ? "smart-list" : source,
    lists: lists.map((l) => ({ id: l.id, name: l.name })),
  };
}

export async function pinWeeklyList(smartListId: string | null, target: number): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: existing } = await supabase
    .from("user_settings")
    .select("owner_id")
    .eq("owner_id", user.id)
    .maybeSingle();

  const patch = {
    weekly_list_smart_list_id: smartListId || null,
    weekly_list_target: Math.min(100, Math.max(5, target || 25)),
    updated_at: new Date().toISOString(),
  };

  const { error } = existing
    ? await supabase.from("user_settings").update(patch).eq("owner_id", user.id)
    : await supabase.from("user_settings").insert({ owner_id: user.id, ...patch });
  if (error) return { error: error.message };
  return {};
}
