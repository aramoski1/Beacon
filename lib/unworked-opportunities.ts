import { parseStoredOwnerContacts } from "@/lib/owner-contacts";
import { resolveLinkedPropertyIds } from "@/lib/contact-properties";

export type UnworkedOpportunity = {
  id: string;
  address: string | null;
  owner_name: string | null;
  owner_contact_name: string | null;
  ingested_at: string | null;
};

export type UnworkedPropertyRow = {
  id: string;
  address: string | null;
  owner_name: string | null;
  owner_contact_name?: string | null;
  owner_contacts: unknown;
  ingested_at: string | null;
};

export type OwnerContactLinkRow = {
  id: string;
  linked_properties?: string[] | null;
};

/** Property IDs already attached to an owner CRM contact (join table first). */
export function collectOwnerLinkedPropertyIds(
  ownerContacts: OwnerContactLinkRow[],
  joinPropertyIdsByContact: Map<string, string[]>,
): Set<string> {
  const linked = new Set<string>();
  for (const c of ownerContacts) {
    for (const pid of resolveLinkedPropertyIds(
      joinPropertyIdsByContact.get(c.id) ?? [],
      c.linked_properties ?? [],
    )) {
      if (pid) linked.add(pid);
    }
  }
  return linked;
}

function displayOwnerContactName(
  ownerContacts: unknown,
  ownerContactName?: string | null,
): string | null {
  const stored = parseStoredOwnerContacts(ownerContacts)[0]?.name?.trim();
  if (stored) return stored;
  const fallback = ownerContactName?.trim();
  return fallback || null;
}

/** Properties with owner data that are not linked to an owner CRM contact. */
export function pickUnworkedOpportunities(
  properties: UnworkedPropertyRow[],
  ownerLinkedPropertyIds: Set<string>,
  limit: number,
): UnworkedOpportunity[] {
  return properties
    .filter((p) => Boolean(p.owner_name?.trim()) && !ownerLinkedPropertyIds.has(p.id))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      address: p.address,
      owner_name: p.owner_name,
      owner_contact_name: displayOwnerContactName(p.owner_contacts, p.owner_contact_name),
      ingested_at: p.ingested_at,
    }));
}
