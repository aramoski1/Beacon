"use server";

import { createClient } from "@/lib/supabase/server";
import { resolvePropertyOwnerContacts, normalizeOwnerName, isEntityOwnerName } from "@/lib/owner-contacts";
import { mdpaSearchModeForName } from "@/lib/mdpa-owner-search";
import {
  entityMatchesProperty,
  personMatchesProperty,
  normalizePersonKey,
  type MdpaSearchQuery,
  type OwnerPortfolioData,
  type OwnerPortfolioProperty,
  type OwnerPortfolioContact,
  type OwnerPortfolioLease,
  type OwnerPortfolioTimelineEvent,
  type PropertyRowForMatch,
  leaseLabel,
} from "@/lib/owner-portfolio";
import { aggregateRelatedEntities, aggregateRelatedPersons } from "@/lib/portfolio-graph";

type RawProperty = PropertyRowForMatch & {
  owner_contact_name?: string | null;
  owner_contact_address?: string | null;
  last_sale_date?: string | null;
  last_sale_price?: number | null;
};

type RawContact = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  contact_tier: number | null;
  last_contacted_at: string | null;
  linked_properties: string[] | null;
  outreach_history: { sent_at: string; subject: string; body: string; method?: string }[] | null;
};

const EMPTY: OwnerPortfolioData = {
  displayName: "Unknown owner",
  subtitle: null,
  source: "property_entity",
  anchorContactId: null,
  anchorPropertyId: null,
  mdpaSearch: null,
  properties: [],
  contacts: [],
  leases: [],
  totalSqft: 0,
  timeline: [],
  relatedEntities: [],
  relatedPersons: [],
};

function dedupeMdpaQueries(queries: MdpaSearchQuery[]): MdpaSearchQuery[] {
  const seen = new Set<string>();
  return queries.filter((q) => {
    const trimmed = q.query.trim();
    if (trimmed.length < 2) return false;
    const key = `${q.mode}:${normalizeOwnerName(trimmed)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mdpaSearchForEntity(ownerName: string): { queries: MdpaSearchQuery[] } {
  return {
    queries: dedupeMdpaQueries([
      { query: ownerName.trim(), mode: "entity", label: ownerName.trim() },
    ]),
  };
}

function mdpaSearchForPerson(personName: string, entityOwnerName: string | null | undefined): { queries: MdpaSearchQuery[] } {
  const queries: MdpaSearchQuery[] = [];
  if (entityOwnerName?.trim() && isEntityOwnerName(entityOwnerName)) {
    queries.push({
      query: entityOwnerName.trim(),
      mode: "entity",
      label: entityOwnerName.trim(),
    });
  }
  queries.push({
    query: personName.trim(),
    mode: "person",
    label: personName.trim(),
  });
  return { queries: dedupeMdpaQueries(queries) };
}

function mdpaSearchForContact(
  contactName: string | null | undefined,
  linkedOwnerNames: string[],
): { queries: MdpaSearchQuery[] } | null {
  const queries: MdpaSearchQuery[] = [];
  for (const ownerName of linkedOwnerNames) {
    if (ownerName.trim()) {
      queries.push({
        query: ownerName.trim(),
        mode: "entity",
        label: ownerName.trim(),
      });
    }
  }
  if (contactName?.trim()) {
    queries.push({
      query: contactName.trim(),
      mode: mdpaSearchModeForName(contactName),
      label: contactName.trim(),
    });
  }
  const deduped = dedupeMdpaQueries(queries);
  return deduped.length > 0 ? { queries: deduped } : null;
}

function toPortfolioProperty(p: RawProperty): OwnerPortfolioProperty {
  return {
    id: p.id,
    address: p.address,
    city: p.city,
    submarket: p.submarket,
    property_type: p.property_type,
    size_sqft: p.size_sqft,
    owner_name: p.owner_name,
    last_sale_date: p.last_sale_date ?? null,
    last_sale_price: p.last_sale_price ?? null,
  };
}

function addressById(properties: OwnerPortfolioProperty[]): Map<string, string | null> {
  return new Map(properties.map((p) => [p.id, p.address]));
}

function collectPropertyIds(
  allProperties: RawProperty[],
  seedIds: Set<string>,
  match: (prop: RawProperty) => boolean,
): string[] {
  const ids = new Set(seedIds);
  for (const prop of allProperties) {
    if (match(prop)) ids.add(prop.id);
  }
  return [...ids];
}

function buildTimeline(params: {
  properties: OwnerPortfolioProperty[];
  contacts: RawContact[];
  leases: OwnerPortfolioLease[];
  activities: {
    id: string;
    contact_id: string;
    property_id: string | null;
    activity_type: string;
    activity_date: string;
    notes: string | null;
  }[];
}): OwnerPortfolioTimelineEvent[] {
  const addrMap = addressById(params.properties);
  const contactName = new Map(params.contacts.map((c) => [c.id, c.name]));
  const events: OwnerPortfolioTimelineEvent[] = [];

  for (const lease of params.leases) {
    const propAddr = lease.linked_property ? addrMap.get(lease.linked_property) ?? null : null;
    if (lease.expiration_date) {
      events.push({
        id: `exp-${lease.id}`,
        kind: "lease_expiration",
        date: lease.expiration_date + "T12:00:00",
        title: `${leaseLabel(lease.source_document)} expires`,
        subtitle: [
          propAddr,
          lease.base_rate != null ? `$${lease.base_rate}/sf` : null,
        ].filter(Boolean).join(" · ") || undefined,
        property_id: lease.linked_property,
        property_address: propAddr,
        href: `/abstracts/${lease.id}`,
      });
    }
    if (lease.execution_date) {
      events.push({
        id: `exec-${lease.id}`,
        kind: "lease_execution",
        date: lease.execution_date + "T12:00:00",
        title: `${leaseLabel(lease.source_document)} executed`,
        subtitle: propAddr ?? undefined,
        property_id: lease.linked_property,
        property_address: propAddr,
        href: `/abstracts/${lease.id}`,
      });
    }
  }

  for (const contact of params.contacts) {
    if (contact.last_contacted_at) {
      events.push({
        id: `lc-${contact.id}`,
        kind: "last_contact",
        date: contact.last_contacted_at,
        title: `Last contacted ${contact.name ?? "contact"}`,
        subtitle: contact.company ?? undefined,
        contact_id: contact.id,
        contact_name: contact.name,
        href: `/contacts/${contact.id}`,
      });
    }
    for (const [i, entry] of (contact.outreach_history ?? []).entries()) {
      events.push({
        id: `out-${contact.id}-${i}`,
        kind: "outreach",
        date: entry.sent_at,
        title: entry.subject || "Outreach logged",
        subtitle: contact.name ?? undefined,
        contact_id: contact.id,
        contact_name: contact.name,
        href: `/contacts/${contact.id}`,
      });
    }
  }

  for (const act of params.activities) {
    const propAddr = act.property_id ? addrMap.get(act.property_id) ?? null : null;
    events.push({
      id: `act-${act.id}`,
      kind: "activity",
      date: act.activity_date,
      title: `${act.activity_type.charAt(0).toUpperCase()}${act.activity_type.slice(1)}${act.notes ? `: ${act.notes}` : ""}`,
      subtitle: [
        contactName.get(act.contact_id),
        propAddr,
      ].filter(Boolean).join(" · ") || undefined,
      property_id: act.property_id,
      property_address: propAddr,
      contact_id: act.contact_id,
      contact_name: contactName.get(act.contact_id) ?? null,
      href: `/contacts/${act.contact_id}`,
    });
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return events;
}

async function loadPortfolioForPropertyIds(
  propertyIds: string[],
  meta: Pick<OwnerPortfolioData, "displayName" | "subtitle" | "source" | "anchorContactId" | "anchorPropertyId" | "mdpaSearch">,
  allProperties: RawProperty[],
): Promise<OwnerPortfolioData> {
  if (propertyIds.length === 0) return { ...EMPTY, ...meta, relatedEntities: [], relatedPersons: [] };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ...EMPTY, ...meta };

  const idSet = new Set(propertyIds);
  const properties = allProperties
    .filter((p) => idSet.has(p.id))
    .map(toPortfolioProperty)
    .sort((a, b) => (a.address ?? "").localeCompare(b.address ?? ""));

  const totalSqft = properties.reduce((sum, p) => sum + (p.size_sqft ?? 0), 0);

  const [{ data: allContacts }, { data: leaseRows }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, email, company, contact_tier, last_contacted_at, linked_properties, outreach_history")
      .eq("owner_id", user.id),
    supabase
      .from("lease_abstracts")
      .select("id, linked_property, source_document, expiration_date, execution_date, base_rate, term")
      .eq("owner_id", user.id)
      .in("linked_property", propertyIds)
      .order("expiration_date", { ascending: true }),
  ]);

  const contactsRaw = ((allContacts ?? []) as RawContact[])
    .filter((c) => (c.linked_properties ?? []).some((pid) => idSet.has(pid)));

  const contacts = contactsRaw
    .map((c): OwnerPortfolioContact => ({
      id: c.id,
      name: c.name,
      email: c.email,
      company: c.company,
      contact_tier: c.contact_tier,
      last_contacted_at: c.last_contacted_at,
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const contactIds = contacts.map((c) => c.id);

  let activityQuery = supabase
    .from("activities")
    .select("id, contact_id, property_id, activity_type, activity_date, notes")
    .eq("owner_id", user.id)
    .order("activity_date", { ascending: false })
    .limit(200);

  if (propertyIds.length > 0 && contactIds.length > 0) {
    activityQuery = activityQuery.or(
      `property_id.in.(${propertyIds.join(",")}),contact_id.in.(${contactIds.join(",")})`,
    );
  } else if (propertyIds.length > 0) {
    activityQuery = activityQuery.in("property_id", propertyIds);
  } else if (contactIds.length > 0) {
    activityQuery = activityQuery.in("contact_id", contactIds);
  } else {
    activityQuery = activityQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { data: activityRows } = await activityQuery;

  const leases = (leaseRows ?? []) as OwnerPortfolioLease[];
  const timeline = buildTimeline({
    properties,
    contacts: contactsRaw,
    leases,
    activities: activityRows ?? [],
  });

  const rawPortfolioProps = allProperties.filter((p) => idSet.has(p.id));
  const relatedEntities = aggregateRelatedEntities(rawPortfolioProps);
  const relatedPersons = aggregateRelatedPersons(rawPortfolioProps);

  return {
    ...meta,
    properties,
    contacts,
    leases,
    totalSqft,
    timeline,
    relatedEntities,
    relatedPersons,
  };
}

async function fetchAllProperties(userId: string): Promise<RawProperty[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("id, address, city, submarket, property_type, size_sqft, owner_name, owner_mailing_address, owner_contacts, owner_contact_name, owner_contact_address, last_sale_date, last_sale_price")
    .eq("owner_id", userId);
  return (data ?? []) as RawProperty[];
}

export async function getOwnerPortfolioForContact(contactId: string): Promise<OwnerPortfolioData | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, name, company, linked_properties")
    .eq("id", contactId)
    .eq("owner_id", user.id)
    .single();

  if (error || !contact) return null;

  const allProperties = await fetchAllProperties(user.id);
  const seedIds = new Set<string>(contact.linked_properties ?? []);

  const entityKeys = new Set<string>();
  const linkedEntityNames: string[] = [];
  for (const pid of seedIds) {
    const prop = allProperties.find((p) => p.id === pid);
    if (prop?.owner_name?.trim()) {
      entityKeys.add(normalizeOwnerName(prop.owner_name));
      if (isEntityOwnerName(prop.owner_name)) {
        linkedEntityNames.push(prop.owner_name.trim());
      }
    }
  }

  const personKey = contact.name ? normalizePersonKey(contact.name) : "";

  const propertyIds = collectPropertyIds(allProperties, seedIds, (prop) => {
    if (entityKeys.size > 0 && prop.owner_name && entityKeys.has(normalizeOwnerName(prop.owner_name))) {
      return true;
    }
    if (personKey && contact.name && personMatchesProperty(contact.name, prop)) return true;
    return false;
  });

  return loadPortfolioForPropertyIds(propertyIds, {
    displayName: contact.name ?? "Unknown contact",
    subtitle: contact.company,
    source: "contact",
    anchorContactId: contact.id,
    anchorPropertyId: seedIds.size > 0 ? [...seedIds][0] : null,
    mdpaSearch: mdpaSearchForContact(contact.name, linkedEntityNames),
  }, allProperties);
}

export async function getOwnerPortfolioForProperty(
  propertyId: string,
  personIndex?: number,
): Promise<OwnerPortfolioData | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const allProperties = await fetchAllProperties(user.id);
  const anchor = allProperties.find((p) => p.id === propertyId);
  if (!anchor) return null;

  if (personIndex != null && personIndex >= 0) {
    const ownerPeople = resolvePropertyOwnerContacts(
      anchor.owner_contacts,
      anchor.owner_name,
      anchor.owner_mailing_address,
      { owner_contact_name: anchor.owner_contact_name, owner_contact_address: anchor.owner_contact_address },
    );
    const person = ownerPeople[personIndex];
    if (!person?.name?.trim()) return null;

    const propertyIds = collectPropertyIds(
      allProperties,
      new Set([propertyId]),
      (prop) => personMatchesProperty(person.name, prop),
    );

    return loadPortfolioForPropertyIds(propertyIds, {
      displayName: person.name,
      subtitle: person.title || anchor.owner_name,
      source: "property_person",
      anchorContactId: null,
      anchorPropertyId: propertyId,
      mdpaSearch: mdpaSearchForPerson(person.name.trim(), anchor.owner_name),
    }, allProperties);
  }

  if (!anchor.owner_name?.trim()) {
    return loadPortfolioForPropertyIds([propertyId], {
      displayName: "Unknown owner",
      subtitle: anchor.address,
      source: "property_entity",
      anchorContactId: null,
      anchorPropertyId: propertyId,
      mdpaSearch: null,
    }, allProperties);
  }

  const entityName = anchor.owner_name.trim();
  const propertyIds = collectPropertyIds(
    allProperties,
    new Set([propertyId]),
    (prop) => entityMatchesProperty(entityName, prop),
  );

  return loadPortfolioForPropertyIds(propertyIds, {
    displayName: entityName,
    subtitle: `${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"} in workspace`,
    source: "property_entity",
    anchorContactId: null,
    anchorPropertyId: propertyId,
    mdpaSearch: mdpaSearchForEntity(entityName),
  }, allProperties);
}
