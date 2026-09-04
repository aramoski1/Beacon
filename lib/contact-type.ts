export const CONTACT_TYPES = ["owner", "tenant", "other"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export function normalizeContactType(raw: string | null | undefined): ContactType | null {
  if (!raw?.trim()) return null;
  const l = raw.toLowerCase().trim();
  if (l === "owner" || l.includes("landlord") || l.includes("ownership")) return "owner";
  if (l === "tenant" || l.includes("lessee") || l.includes("occupant")) return "tenant";
  if (l === "other") return "other";
  return null;
}

export function contactTypeLabel(type: string | null | undefined): string {
  if (type === "owner") return "Owner";
  if (type === "tenant") return "Tenant";
  if (type === "other") return "Other";
  return "—";
}
