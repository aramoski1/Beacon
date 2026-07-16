/**
 * Pure helpers for aggregating entity/person networks across a portfolio.
 * No server or DB dependencies — fully testable.
 */
import { normalizeOwnerName, resolvePropertyOwnerContacts } from "./owner-contacts";
import { normalizePersonKey } from "./owner-portfolio";

export type RelatedEntity = {
  name: string;
  propertyCount: number;
};

export type RelatedPerson = {
  name: string;
  title: string | null;
  propertyCount: number;
};

/** Aggregate unique entity (owner_name) values across properties, sorted by frequency. */
export function aggregateRelatedEntities(
  properties: Array<{ owner_name: string | null }>
): RelatedEntity[] {
  const map = new Map<string, { name: string; count: number }>();
  for (const p of properties) {
    const name = p.owner_name?.trim();
    if (!name) continue;
    const key = normalizeOwnerName(name);
    if (!map.has(key)) {
      map.set(key, { name, count: 0 });
    }
    map.get(key)!.count++;
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ name, count }) => ({ name, propertyCount: count }));
}

/** Aggregate unique persons from owner_contacts across properties, sorted by frequency. */
export function aggregateRelatedPersons(
  properties: Array<{
    owner_contacts: unknown;
    owner_name: string | null;
    owner_mailing_address: string | null;
  }>
): RelatedPerson[] {
  const map = new Map<string, { name: string; title: string | null; count: number }>();
  for (const p of properties) {
    const persons = resolvePropertyOwnerContacts(
      p.owner_contacts,
      p.owner_name,
      p.owner_mailing_address
    );
    for (const person of persons) {
      const name = person.name.trim();
      if (!name) continue;
      const key = normalizePersonKey(name);
      if (!map.has(key)) {
        map.set(key, { name, title: person.title || null, count: 0 });
      }
      map.get(key)!.count++;
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map(({ name, title, count }) => ({ name, title, propertyCount: count }));
}
