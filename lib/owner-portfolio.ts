/** Owner portfolio — identity matching and timeline helpers (client-safe). */

import { normalizeOwnerName, resolvePropertyOwnerContacts } from "@/lib/owner-contacts";
import { entityOwnerNamesMatch } from "@/lib/mdpa-owner-search";

export type OwnerPortfolioSource = "contact" | "property_entity" | "property_person";

export type OwnerPortfolioProperty = {
  id: string;
  address: string | null;
  city: string | null;
  submarket: string | null;
  property_type: string | null;
  size_sqft: number | null;
  owner_name: string | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
};

export type OwnerPortfolioRelatedEntity = {
  name: string;
  propertyCount: number;
};

export type OwnerPortfolioRelatedPerson = {
  name: string;
  title: string | null;
  propertyCount: number;
};

export type OwnerPortfolioContact = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  contact_tier: number | null;
  last_contacted_at: string | null;
};

export type OwnerPortfolioLease = {
  id: string;
  linked_property: string | null;
  source_document: string | null;
  expiration_date: string | null;
  execution_date: string | null;
  base_rate: number | null;
  term: string | null;
};

export type OwnerPortfolioTimelineKind =
  | "lease_expiration"
  | "lease_execution"
  | "last_contact"
  | "outreach"
  | "activity";

export type OwnerPortfolioTimelineEvent = {
  id: string;
  kind: OwnerPortfolioTimelineKind;
  date: string;
  title: string;
  subtitle?: string;
  property_id?: string | null;
  property_address?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  href?: string;
};

export type MdpaSearchQuery = {
  query: string;
  mode: "entity" | "person";
  label?: string;
};

export type OwnerPortfolioData = {
  displayName: string;
  subtitle: string | null;
  source: OwnerPortfolioSource;
  anchorContactId: string | null;
  anchorPropertyId: string | null;
  /** Durable legal-entity id when portfolio is keyed off entities table. */
  entityId: string | null;
  /** Tax roll owner searches for county-wide portfolio discovery. */
  mdpaSearch: { queries: MdpaSearchQuery[] } | null;
  properties: OwnerPortfolioProperty[];
  contacts: OwnerPortfolioContact[];
  leases: OwnerPortfolioLease[];
  totalSqft: number;
  timeline: OwnerPortfolioTimelineEvent[];
  /** Unique ownership entities (owner_name values) across portfolio properties. */
  relatedEntities: OwnerPortfolioRelatedEntity[];
  /** Unique persons extracted from owner_contacts across portfolio properties. */
  relatedPersons: OwnerPortfolioRelatedPerson[];
};

export type PropertyRowForMatch = {
  id: string;
  address: string | null;
  city: string | null;
  submarket: string | null;
  property_type: string | null;
  size_sqft: number | null;
  owner_name: string | null;
  owner_mailing_address: string | null;
  owner_contacts: unknown;
  entity_id?: string | null;
};

export function normalizePersonKey(name: string): string {
  return normalizeOwnerName(name);
}

export function personMatchesProperty(personName: string, prop: PropertyRowForMatch): boolean {
  const key = normalizePersonKey(personName);
  if (!key) return false;
  if (prop.owner_name && normalizePersonKey(prop.owner_name) === key) return true;
  const contacts = resolvePropertyOwnerContacts(
    prop.owner_contacts,
    prop.owner_name,
    prop.owner_mailing_address,
  );
  return contacts.some((oc) => normalizePersonKey(oc.name) === key);
}

export function entityMatchesProperty(entityName: string, prop: PropertyRowForMatch): boolean {
  if (!entityName.trim() || !prop.owner_name?.trim()) return false;
  return entityOwnerNamesMatch(entityName, prop.owner_name);
}

export function ownerPortfolioHref(
  input:
    | { type: "contact"; contactId: string }
    | { type: "property"; propertyId: string; personIndex?: number },
): string {
  if (input.type === "contact") {
    return `/owner-portfolio/contact/${input.contactId}`;
  }
  const base = `/owner-portfolio/property/${input.propertyId}`;
  if (input.personIndex != null) return `${base}?person=${input.personIndex}`;
  return base;
}

export function fmtPortfolioSqft(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M sf`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K sf`;
  return `${n.toLocaleString()} sf`;
}

export function leaseLabel(path: string | null): string {
  if (!path) return "Lease abstract";
  const name = path.split("/").pop() ?? path;
  return name.length > 36 ? name.slice(0, 34) + "…" : name;
}

export const TIMELINE_KIND_META: Record<
  OwnerPortfolioTimelineKind,
  { label: string; className: string }
> = {
  lease_expiration: {
    label: "Lease expiry",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400",
  },
  lease_execution: {
    label: "Lease start",
    className: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-400",
  },
  last_contact: {
    label: "Last contact",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  outreach: {
    label: "Outreach",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-400",
  },
  activity: {
    label: "Activity",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
};
