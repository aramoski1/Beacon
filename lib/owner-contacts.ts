/** Sunbiz authorized person stored on the property row (not a CRM contact). */
export type StoredOwnerContact = {
  name: string;
  title: string;
  address: string | null;
};

export function storedOwnerContactsFromSunbiz(
  persons: { name: string; title: string; address: string | null }[],
): StoredOwnerContact[] {
  return persons.map((p) => ({
    name: p.name.trim(),
    title: p.title.trim(),
    address: p.address?.trim() || null,
  }));
}

export function parseStoredOwnerContacts(raw: unknown): StoredOwnerContact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => ({
      name: String(item.name ?? "").trim(),
      title: String(item.title ?? "").trim(),
      address: item.address != null ? String(item.address).trim() || null : null,
    }))
    .filter((item) => item.name.length > 0);
}

/** Normalize owner/entity names for portfolio matching. */
export function normalizeOwnerName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

/** True when the MDPA owner name looks like a registered entity (Sunbiz-eligible). */
export function isEntityOwnerName(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  const norm = name.replace(/\./g, "");
  return /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(norm);
}

/** Individual (non-entity) owner from MDPA → property-row owner contact. */
export function mdpaIndividualOwnerContact(
  ownerName: string | null | undefined,
  mailingAddress?: string | null,
): StoredOwnerContact[] {
  if (!ownerName?.trim() || isEntityOwnerName(ownerName)) return [];
  return [{
    name: ownerName.trim(),
    title: "",
    address: mailingAddress?.trim() || null,
  }];
}

/** Owner contacts for display/save: stored Sunbiz rows, else MDPA individual owner. */
export function resolvePropertyOwnerContacts(
  ownerContacts: unknown,
  ownerName: string | null | undefined,
  ownerMailingAddress?: string | null,
  legacy?: {
    owner_contact_name?: string | null;
    owner_contact_address?: string | null;
  },
): StoredOwnerContact[] {
  let list = parseStoredOwnerContacts(ownerContacts);
  if (list.length === 0 && legacy?.owner_contact_name?.trim()) {
    list.push({
      name: legacy.owner_contact_name.trim(),
      title: "",
      address: legacy.owner_contact_address?.trim() || null,
    });
  }
  if (list.length === 0) {
    list = mdpaIndividualOwnerContact(ownerName, ownerMailingAddress);
  } else if (!isEntityOwnerName(ownerName)) {
    // Individual owners only — fill missing address from MDPA mailing, not Sunbiz entity contacts.
    const mailing = ownerMailingAddress?.trim();
    if (mailing) {
      list = list.map((oc) => ({
        ...oc,
        address: oc.address?.trim() || mailing,
      }));
    }
  }
  return list;
}

/** Linked CRM contact used for outreach / cadence (preferred over property staging). */
export type LinkedCrmOwnerRef = {
  id: string;
  name: string | null;
  email: string | null;
  mailing_address: string | null;
};

export type DisplayOwnerContact = {
  source: "crm" | "staging";
  /** CRM contact id when source === "crm" */
  contactId: string | null;
  name: string | null;
  email: string | null;
  address: string | null;
  /** Staging rows still on the property (may differ from CRM). */
  staging: StoredOwnerContact[];
};

/**
 * Prefer linked CRM contact for Workspace display; fall back to property staging.
 * Does not invent contacts — empty when neither exists.
 */
export function preferDisplayOwnerContact(opts: {
  linkedCrm: LinkedCrmOwnerRef[];
  ownerContacts: unknown;
  ownerName: string | null | undefined;
  ownerMailingAddress?: string | null;
  ownerEmail?: string | null;
}): DisplayOwnerContact | null {
  const staging = resolvePropertyOwnerContacts(
    opts.ownerContacts,
    opts.ownerName,
    opts.ownerMailingAddress,
  );
  const crm = opts.linkedCrm[0] ?? null;
  if (crm) {
    return {
      source: "crm",
      contactId: crm.id,
      name: crm.name,
      email: crm.email,
      address: crm.mailing_address,
      staging,
    };
  }
  if (staging.length === 0 && !opts.ownerEmail?.trim()) return null;
  const first = staging[0];
  return {
    source: "staging",
    contactId: null,
    name: first?.name ?? null,
    email: opts.ownerEmail?.trim() || null,
    address: first?.address ?? (opts.ownerMailingAddress?.trim() || null),
    staging,
  };
}

/** True when staging name differs from CRM (broker should reconcile). */
export function stagingDiffersFromCrm(
  staging: StoredOwnerContact[],
  crmName: string | null | undefined,
): boolean {
  const s = staging[0]?.name?.trim().toLowerCase() ?? "";
  const c = crmName?.trim().toLowerCase() ?? "";
  if (!s || !c) return false;
  return s !== c;
}
