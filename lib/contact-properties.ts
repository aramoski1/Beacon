/**
 * contact_properties join helpers.
 * Prefer this over contacts.linked_properties UUID[] (kept as a write shim).
 */

export type ContactPropertyLink = {
  contact_id: string;
  property_id: string;
};

/** Link contact ↔ property in the join table (idempotent). */
export async function linkContactProperty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  contactId: string,
  propertyId: string,
): Promise<void> {
  const { error } = await supabase.from("contact_properties").upsert(
    {
      owner_id: userId,
      contact_id: contactId,
      property_id: propertyId,
    },
    { onConflict: "contact_id,property_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`contact_properties link failed: ${error.message}`);
}

/** Dual-write shim: keep legacy UUID[] in sync after join insert. */
export async function syncLinkedPropertiesArray(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  contactId: string,
): Promise<string[]> {
  const ids = await propertyIdsForContact(supabase, userId, contactId);
  const { error } = await supabase
    .from("contacts")
    .update({
      linked_properties: ids,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId)
    .eq("owner_id", userId);
  if (error) throw new Error(`linked_properties shim sync failed: ${error.message}`);
  return ids;
}

/** Link + refresh legacy array. Call after creating a contact with a property. */
export async function linkContactPropertyAndSync(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  contactId: string,
  propertyId: string,
): Promise<void> {
  await linkContactProperty(supabase, userId, contactId, propertyId);
  await syncLinkedPropertiesArray(supabase, userId, contactId);
}

export async function propertyIdsForContact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  contactId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("contact_properties")
    .select("property_id")
    .eq("owner_id", userId)
    .eq("contact_id", contactId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { property_id: string }) => r.property_id);
}

export async function contactIdsForProperty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  propertyId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("contact_properties")
    .select("contact_id")
    .eq("owner_id", userId)
    .eq("property_id", propertyId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { contact_id: string }) => r.contact_id);
}

/** Contact IDs that link to any of the given property IDs. */
export async function contactIdsForProperties(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  propertyIds: string[],
): Promise<string[]> {
  if (propertyIds.length === 0) return [];
  const { data, error } = await supabase
    .from("contact_properties")
    .select("contact_id")
    .eq("owner_id", userId)
    .in("property_id", propertyIds);
  if (error) throw new Error(error.message);
  const ids: string[] = (data ?? []).map(
    (r: { contact_id: string }) => String(r.contact_id),
  );
  return Array.from(new Set(ids));
}
export async function propertyIdsByContactIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  contactIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (contactIds.length === 0) return map;
  for (const id of contactIds) map.set(id, []);

  const { data, error } = await supabase
    .from("contact_properties")
    .select("contact_id, property_id")
    .eq("owner_id", userId)
    .in("contact_id", contactIds);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const list = map.get(row.contact_id) ?? [];
    list.push(row.property_id);
    map.set(row.contact_id, list);
  }
  return map;
}

/** Map property_id → contact rows' ids (for CRM property→contacts). */
export async function contactIdsByPropertyIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  propertyIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (propertyIds.length === 0) return map;
  for (const id of propertyIds) map.set(id, []);

  const { data, error } = await supabase
    .from("contact_properties")
    .select("contact_id, property_id")
    .eq("owner_id", userId)
    .in("property_id", propertyIds);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const list = map.get(row.property_id) ?? [];
    list.push(row.contact_id);
    map.set(row.property_id, list);
  }
  return map;
}

/**
 * Prefer join-table IDs; fall back to legacy linked_properties array.
 * Pure helper for tests + gradual migration.
 */
export function resolveLinkedPropertyIds(
  joinIds: string[] | null | undefined,
  legacyIds: string[] | null | undefined,
): string[] {
  if (joinIds && joinIds.length > 0) return [...new Set(joinIds)];
  if (legacyIds && legacyIds.length > 0) return [...new Set(legacyIds)];
  return [];
}
