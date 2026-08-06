/** Durable legal-entity helpers (entities / entity_properties / entity_contacts). */

import { isEntityOwnerName, normalizeOwnerName } from "@/lib/owner-contacts";

export type EntityKind = "entity" | "individual" | "unknown";

export type EntityRow = {
  id: string;
  owner_id: string;
  name: string;
  name_normalized: string;
  kind: EntityKind;
};

/** Canonical key stored on entities.name_normalized. */
export function entityNameKey(name: string): string {
  return normalizeOwnerName(name);
}

export function entityKindFromName(name: string | null | undefined): EntityKind {
  if (!name?.trim()) return "unknown";
  return isEntityOwnerName(name) ? "entity" : "individual";
}

/**
 * Ensure an entity row exists for this owner name; return its id.
 * No-op (null) when name is empty.
 */
export async function upsertEntityByName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  ownerName: string,
): Promise<string | null> {
  const name = ownerName.trim();
  if (!name) return null;
  const name_normalized = entityNameKey(name);
  const kind = entityKindFromName(name);

  const { data: existing } = await supabase
    .from("entities")
    .select("id")
    .eq("owner_id", userId)
    .eq("name_normalized", name_normalized)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("entities")
      .update({ name, kind, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("owner_id", userId);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from("entities")
    .insert({
      owner_id: userId,
      name,
      name_normalized,
      kind,
    })
    .select("id")
    .single();

  if (error) {
    // Race: unique violation — fetch again
    const { data: raced } = await supabase
      .from("entities")
      .select("id")
      .eq("owner_id", userId)
      .eq("name_normalized", name_normalized)
      .maybeSingle();
    if (raced?.id) return raced.id as string;
    throw new Error(`Entity upsert failed: ${error.message}`);
  }

  return data.id as string;
}

/** Link property ↔ entity and set properties.entity_id. */
export async function linkPropertyToEntity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  propertyId: string,
  entityId: string,
): Promise<void> {
  const [{ data: property }, { data: entity }] = await Promise.all([
    supabase.from("properties").select("id").eq("id", propertyId).eq("owner_id", userId).maybeSingle(),
    supabase.from("entities").select("id").eq("id", entityId).eq("owner_id", userId).maybeSingle(),
  ]);
  if (!property) throw new Error("entity_properties link failed: property does not belong to this owner");
  if (!entity) throw new Error("entity_properties link failed: entity does not belong to this owner");

  const { error: linkErr } = await supabase.from("entity_properties").upsert(
    {
      owner_id: userId,
      entity_id: entityId,
      property_id: propertyId,
    },
    { onConflict: "entity_id,property_id", ignoreDuplicates: true },
  );
  if (linkErr) throw new Error(`entity_properties link failed: ${linkErr.message}`);

  const { error: propErr } = await supabase
    .from("properties")
    .update({ entity_id: entityId, updated_at: new Date().toISOString() })
    .eq("id", propertyId)
    .eq("owner_id", userId);
  if (propErr) throw new Error(`properties.entity_id update failed: ${propErr.message}`);
}

/**
 * Sync entity membership from a property's owner_name.
 * Clears entity_id when owner_name is empty.
 */
export async function syncPropertyEntity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  propertyId: string,
  ownerName: string | null | undefined,
): Promise<string | null> {
  if (!ownerName?.trim()) {
    await supabase
      .from("properties")
      .update({ entity_id: null, updated_at: new Date().toISOString() })
      .eq("id", propertyId)
      .eq("owner_id", userId);
    await supabase
      .from("entity_properties")
      .delete()
      .eq("property_id", propertyId)
      .eq("owner_id", userId);
    return null;
  }

  const entityId = await upsertEntityByName(supabase, userId, ownerName);
  if (!entityId) return null;

  // Drop stale links for this property (owner may have changed)
  await supabase
    .from("entity_properties")
    .delete()
    .eq("property_id", propertyId)
    .eq("owner_id", userId)
    .neq("entity_id", entityId);

  await linkPropertyToEntity(supabase, userId, propertyId, entityId);
  return entityId;
}

/** Link a CRM contact to an entity (idempotent). */
export async function linkContactToEntity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  entityId: string,
  contactId: string,
  role?: string | null,
): Promise<void> {
  const [{ data: entity }, { data: contact }] = await Promise.all([
    supabase.from("entities").select("id").eq("id", entityId).eq("owner_id", userId).maybeSingle(),
    supabase.from("contacts").select("id").eq("id", contactId).eq("owner_id", userId).maybeSingle(),
  ]);
  if (!entity) throw new Error("entity_contacts link failed: entity does not belong to this owner");
  if (!contact) throw new Error("entity_contacts link failed: contact does not belong to this owner");

  const { error } = await supabase.from("entity_contacts").upsert(
    {
      owner_id: userId,
      entity_id: entityId,
      contact_id: contactId,
      role: role?.trim() || null,
    },
    { onConflict: "entity_id,contact_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`entity_contacts link failed: ${error.message}`);
}

/** All property IDs linked to an entity (via join table). */
export async function propertyIdsForEntity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  entityId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("entity_properties")
    .select("property_id")
    .eq("owner_id", userId)
    .eq("entity_id", entityId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { property_id: string }) => r.property_id);
}

/** Collect property IDs for an entity, unioned with a seed set. Pure helper for tests. */
export function mergeEntityPropertyIds(
  seedIds: Iterable<string>,
  entityLinkedIds: Iterable<string>,
): string[] {
  const out = new Set<string>();
  for (const id of seedIds) out.add(id);
  for (const id of entityLinkedIds) out.add(id);
  return [...out];
}
