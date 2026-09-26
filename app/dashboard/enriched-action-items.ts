"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/app/settings/actions";
import { daysUntilExpiry } from "@/lib/lease-radar";
import { addCalendarDays, todayLocal } from "@/lib/dates";
import { hydrateContactLinkedProperties } from "@/lib/contact-properties";
import { cadenceMapFromSettings, suggestedCadenceDays } from "@/lib/cadence";
import {
  buildSignals,
  formatWhyNow,
  formatComposeContext,
  signalPriorityScore,
  type EnrichedActionItem,
  type EnrichedProperty,
} from "@/lib/action-item-signals";

export async function getEnrichedActionItems(): Promise<EnrichedActionItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const now = new Date();
  const today = todayLocal();
  const cutoff12 = addCalendarDays(today, 365);

  const [
    { data: contacts },
    settings,
    { data: properties },
    { data: leases },
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, email, company, contact_tier, last_contacted_at, linked_properties")
      .not("contact_tier", "is", null),
    getUserSettings(),
    supabase
      .from("properties")
      .select("id, address, size_sqft, land_sqft, zoning_far, zoning_code, ownership_change_detected_at, ownership_change_data"),
    supabase
      .from("lease_abstracts")
      .select("id, expiration_date, linked_property, properties(id, address, size_sqft)")
      .eq("owner_id", user.id)
      .not("expiration_date", "is", null)
      .gte("expiration_date", today)
      .lte("expiration_date", cutoff12),
  ]);

  if (!contacts) return [];

  const hydratedContacts = await hydrateContactLinkedProperties(
    supabase,
    user.id,
    contacts,
  );

  const cadence = cadenceMapFromSettings(settings);

  // Build property lookup map
  type RawProp = {
    id: string;
    address: string | null;
    size_sqft: number | null;
    land_sqft: number | null;
    zoning_far: number | null;
    zoning_code: string | null;
    ownership_change_detected_at: string | null;
    ownership_change_data: unknown;
  };
  const propMap = new Map<string, RawProp>(
    (properties ?? []).map((p) => [p.id, p as RawProp])
  );

  // Build changed-properties map: id → { newOwner }
  const changedProperties = new Map<string, { newOwner: string | null }>();
  for (const p of properties ?? []) {
    if ((p as RawProp).ownership_change_detected_at != null) {
      const data = (p as RawProp).ownership_change_data as
        | { new_owner?: string | null }
        | null;
      changedProperties.set(p.id, { newOwner: data?.new_owner ?? null });
    }
  }

  // Build lease lookup: property ID → expiring leases
  const leasesByProperty = new Map<
    string,
    Array<{
      leaseId: string;
      daysUntilExpiry: number;
      address: string | null;
      sqft: number | null;
    }>
  >();
  for (const l of leases ?? []) {
    const propertyId = l.linked_property as string | null;
    if (!propertyId || !l.expiration_date) continue;
    const days = daysUntilExpiry(l.expiration_date, now);
    if (days < 0) continue;
    const prop = l.properties as unknown as {
      id: string;
      address: string | null;
      size_sqft: number | null;
    } | null;
    const list = leasesByProperty.get(propertyId) ?? [];
    list.push({
      leaseId: l.id,
      daysUntilExpiry: days,
      address: prop?.address ?? null,
      sqft: prop?.size_sqft ?? null,
    });
    leasesByProperty.set(propertyId, list);
  }

  const SHOW_WITHIN_DAYS = 7;

  const items: EnrichedActionItem[] = hydratedContacts
    .map((c) => {
      const tier = c.contact_tier as number | null;
      const cadenceDays = suggestedCadenceDays(tier, cadence);
      const daysSinceContact = c.last_contacted_at
        ? Math.floor(
            (Date.now() - new Date(c.last_contacted_at).getTime()) / 86_400_000
          )
        : 999;
      const daysOverdue = c.last_contacted_at
        ? daysSinceContact - cadenceDays
        : cadenceDays;

      const linkedPropIds: string[] = c.linked_properties;
      const resolvedProperties: EnrichedProperty[] = linkedPropIds
        .map((pid) => propMap.get(pid))
        .filter(Boolean)
        .map((p) => ({
          id: p!.id,
          address: p!.address,
          size_sqft: p!.size_sqft,
          land_sqft: p!.land_sqft,
          zoning_far: p!.zoning_far,
          zoning_code: p!.zoning_code,
        }));

      const expiringLeases = linkedPropIds.flatMap(
        (pid) => leasesByProperty.get(pid) ?? []
      );

      const signals = buildSignals({
        contact: { contact_tier: tier, last_contacted_at: c.last_contacted_at as string | null },
        resolvedProperties,
        expiringLeases,
        changedProperties,
        daysOverdue,
        daysSinceContact,
      });

      return {
        id: c.id,
        name: c.name as string | null,
        email: c.email as string | null,
        company: c.company as string | null,
        contact_tier: tier,
        last_contacted_at: c.last_contacted_at as string | null,
        daysSinceContact,
        daysOverdue,
        cadenceDays,
        signals,
        whyNow: formatWhyNow(signals, c.name as string | null, daysSinceContact),
        composeContext: formatComposeContext(signals, daysSinceContact),
        resolvedProperties,
      };
    })
    .filter((item) => {
      if (item.daysOverdue >= -SHOW_WITHIN_DAYS) return true;
      // Also include contacts not yet due but with urgent signals
      if (
        item.signals.some(
          (s) =>
            (s.kind === "lease_expiring" && s.daysUntilExpiry <= 90) ||
            s.kind === "ownership_changed"
        )
      )
        return true;
      return false;
    })
    .sort((a, b) => {
      const priorityDiff =
        signalPriorityScore(b.signals) - signalPriorityScore(a.signals);
      if (priorityDiff !== 0) return priorityDiff;
      return b.daysOverdue - a.daysOverdue;
    });

  return items;
}
