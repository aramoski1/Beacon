import { splitContactName } from "@/lib/contact-name";

/** Merge tokens for outreach drafts — replaced after AI generate and before compose. */

export type OutreachMergeVars = {
  name: string;
  first_name: string;
  address: string;
  sf: string;
  landlord: string;
  expiry: string;
};

export const MERGE_TOKENS = [
  { token: "{first_name}", hint: "First name" },
  { token: "{name}", hint: "Full name" },
  { token: "{address}", hint: "Property address" },
  { token: "{sf}", hint: "Tenant or building SF" },
  { token: "{landlord}", hint: "Landlord / owner entity" },
  { token: "{expiry}", hint: "Lease expiry" },
] as const;

export const DEFAULT_MERGE_SUBJECT = "Following up — {address}";

export const DEFAULT_MERGE_TEMPLATE = `Hi {first_name},

I wanted to check in on {address}. {sf}

Best,`;

export function firstNameFromFullName(name: string | null | undefined): string {
  return splitContactName(name).greeting;
}

export function applyOutreachMerge(text: string, vars: OutreachMergeVars): string {
  const replaced = text
    .replace(/\{first_name\}/gi, vars.first_name)
    .replace(/\{name\}/gi, vars.name)
    .replace(/\{address\}/gi, vars.address)
    .replace(/\{sf\}/gi, vars.sf)
    .replace(/\{landlord\}/gi, vars.landlord)
    .replace(/\{expiry\}/gi, vars.expiry);
  return replaced.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatMergeSf(sqft: number | null | undefined): string {
  if (sqft == null || !Number.isFinite(sqft)) return "";
  return `${Math.round(sqft).toLocaleString()} SF`;
}

export function formatMergeExpiry(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function mergeVarsFromOccupancy(input: {
  name: string | null;
  address?: string | null;
  sizeSqft?: number | null;
  leasedSf?: number | null;
  landlord?: string | null;
  expiry?: string | null;
}): OutreachMergeVars {
  const name = input.name?.trim() || "there";
  return {
    name,
    first_name: firstNameFromFullName(input.name),
    address: input.address?.trim() || "",
    sf: formatMergeSf(input.leasedSf ?? input.sizeSqft),
    landlord: input.landlord?.trim() || "",
    expiry: formatMergeExpiry(input.expiry),
  };
}
