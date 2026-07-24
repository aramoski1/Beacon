/**
 * Pure corridor / book geography helpers for the map-lite desk.
 */

export type BookPropertyPin = {
  id: string;
  address: string | null;
  city: string | null;
  submarket: string | null;
  sizeSqft: number | null;
  propertyType: string | null;
};

export type CorridorBucket = {
  key: string;
  label: string;
  count: number;
  totalSqft: number;
  properties: BookPropertyPin[];
};

export function corridorKey(p: Pick<BookPropertyPin, "submarket" | "city">): string {
  const sub = p.submarket?.trim();
  if (sub) return `sub:${sub.toLowerCase()}`;
  const city = p.city?.trim();
  if (city) return `city:${city.toLowerCase()}`;
  return "unknown";
}

export function corridorLabel(p: Pick<BookPropertyPin, "submarket" | "city">): string {
  if (p.submarket?.trim()) return p.submarket.trim();
  if (p.city?.trim()) return p.city.trim();
  return "Unassigned corridor";
}

export function groupBookByCorridor(
  properties: BookPropertyPin[],
  opts?: { minSqft?: number | null; maxSqft?: number | null; propertyType?: string | null },
): CorridorBucket[] {
  const min = opts?.minSqft ?? null;
  const max = opts?.maxSqft ?? null;
  const type = opts?.propertyType?.trim().toLowerCase() || null;

  const filtered = properties.filter((p) => {
    if (type && (p.propertyType ?? "").trim().toLowerCase() !== type) return false;
    if (min != null && (p.sizeSqft == null || p.sizeSqft < min)) return false;
    if (max != null && (p.sizeSqft == null || p.sizeSqft > max)) return false;
    return true;
  });

  const map = new Map<string, CorridorBucket>();
  for (const p of filtered) {
    const key = corridorKey(p);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        label: corridorLabel(p),
        count: 1,
        totalSqft: p.sizeSqft ?? 0,
        properties: [p],
      });
    } else {
      existing.count += 1;
      existing.totalSqft += p.sizeSqft ?? 0;
      existing.properties.push(p);
    }
  }

  return [...map.values()].sort(
    (a, b) => b.count - a.count || b.totalSqft - a.totalSqft || a.label.localeCompare(b.label),
  );
}

/** OpenStreetMap search URL — honest external map, no geocode storage required. */
export function osmSearchUrl(address: string | null, city: string | null): string | null {
  const q = [address, city, "FL"].filter(Boolean).join(", ");
  if (!address?.trim()) return null;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
}
