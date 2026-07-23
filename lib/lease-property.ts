// Pure helpers for lease ↔ property linkage. No server/client directive.

export const LEASE_PROPERTY_REQUIRED_MSG =
  "This lease isn't on a property — radar can't track expiration. Link a property before saving.";

export const LEASE_PROPERTY_UNLINK_BLOCKED_MSG =
  "This lease isn't on a property — radar can't track expiration. Relink to another property instead of clearing.";

/** Reject null/empty linked_property. Returns an error message or null if valid. */
export function requireLinkedPropertyId(
  linkedProperty: string | null | undefined,
): string | null {
  if (!linkedProperty?.trim()) return LEASE_PROPERTY_REQUIRED_MSG;
  return null;
}

export type PropertyMatchOption = {
  id: string;
  address: string;
  city: string | null;
};

/**
 * Best-effort address match for batch linking.
 * Prefers exact (case-insensitive) address equality, then substring contains.
 */
export function matchPropertyByAddress(
  properties: PropertyMatchOption[],
  premisesAddress: string | null | undefined,
): PropertyMatchOption | null {
  const q = premisesAddress?.trim().toLowerCase();
  if (!q || properties.length === 0) return null;

  const exact = properties.find((p) => p.address.toLowerCase() === q);
  if (exact) return exact;

  const contains = properties.find((p) => {
    const addr = p.address.toLowerCase();
    const withCity = p.city ? `${addr}, ${p.city.toLowerCase()}` : addr;
    return addr.includes(q) || q.includes(addr) || withCity.includes(q);
  });
  return contains ?? null;
}
