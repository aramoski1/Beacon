// Miami-Dade tax roll owner search via ArcGIS Parcels layer (MapServer/26).
// Used by owner portfolio to discover county-wide holdings, not just CRM rows.

import { folioToStrap } from "./mdpa";
import { normalizeOwnerName, personNameMatchesOwnerField } from "@/lib/owner-contacts";

const MDPA_PARCELS_QUERY_URL =
  "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query";

const OWNER_FIELDS = ["TRUE_OWNER1", "TRUE_OWNER2", "TRUE_OWNER3"] as const;

const PAGE_SIZE = 1000;
const MAX_PARCELS = 3000;

export type MdpaSearchMode = "entity" | "person";

export type MdpaOwnerParcelHit = {
  folio: string;
  strap: string;
  ownerName: string;
  address: string | null;
  city: string | null;
  buildingSqft: number | null;
};

type GisAttributes = {
  FOLIO?: string;
  TRUE_OWNER1?: string;
  TRUE_OWNER2?: string;
  TRUE_OWNER3?: string;
  TRUE_SITE_ADDR?: string;
  TRUE_SITE_CITY?: string;
  BUILDING_ACTUAL_AREA?: number | null;
};

const ENTITY_STOP_WORDS = new Set([
  "LLC", "INC", "CORP", "LP", "LLP", "LLLP", "LTD", "CO", "PA", "PL", "PLLC",
  "THE", "AND", "OF", "A", "FL", "FLORIDA",
]);

function sanitizeLikeToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip legal suffixes / noise for portfolio grouping. */
export function stripEntityCore(name: string): string {
  return normalizeOwnerName(name)
    .replace(/\b(a florida|a fl|florida)\b/g, "")
    .replace(/\b(llc|inc|corp|lp|llp|lllp|ltd|co|pa|pl|pllc)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a tax roll owner name belongs to the same entity portfolio as the anchor query.
 *
 * Precision over recall: a false match here silently merges two unrelated legal
 * entities' properties into one CRM portfolio view, which is worse than missing
 * a real variant. Real-estate LLCs are routinely named after either a generic
 * business word ("Holdings", "Enterprises", "Properties") or a shared street /
 * neighborhood ("West Brickell", "Miami", "Paradise") — order-independent,
 * bag-of-words token overlap reliably collides on those, since unrelated owners
 * constantly share individual words. Order- and adjacency-sensitive comparisons
 * don't have that failure mode (two unrelated names essentially never produce
 * the same contiguous multi-word phrase by chance), so matching is restricted to:
 *   1. exact normalized-name equality
 *   2. exact match after stripping legal suffix / state noise ("LLC", "A FL", ...)
 *   3. one full (2+-word) core appearing as a contiguous substring of the other
 */
export function entityOwnerNamesMatch(query: string, ownerField: string): boolean {
  const qNorm = normalizeOwnerName(query);
  const oNorm = normalizeOwnerName(ownerField);
  if (!qNorm || !oNorm) return false;
  if (qNorm === oNorm) return true;

  const qCore = stripEntityCore(query);
  const oCore = stripEntityCore(ownerField);
  if (qCore.length >= 4 && qCore === oCore) return true;

  // A single-word core is exactly the generic/geographic-word collision case
  // above, so require at least two words before trusting "core appears
  // somewhere in the other name" as a contiguous substring.
  const qCoreWords = qCore.split(/\s+/).filter(Boolean);
  const oCoreWords = oCore.split(/\s+/).filter(Boolean);
  if (qCoreWords.length >= 2 && qCore.length >= 5 && oNorm.includes(qCore)) return true;
  if (oCoreWords.length >= 2 && oCore.length >= 5 && qNorm.includes(oCore)) return true;

  return false;
}

function entitySearchTokens(query: string): string[] {
  const upper = sanitizeLikeToken(query).toUpperCase();
  let tokens = upper
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !ENTITY_STOP_WORDS.has(w));
  if (tokens.length === 0) {
    tokens = upper.split(/\s+/).filter((w) => w.length >= 2);
  }
  tokens.sort((a, b) => b.length - a.length);
  return tokens.slice(0, 2);
}

function buildOwnerWhereClause(query: string, mode: MdpaSearchMode): string {
  const safe = sanitizeLikeToken(query);
  if (safe.length < 2) {
    throw new Error("Owner name is too short to search the tax roll.");
  }

  if (mode === "person") {
    const parts = safe.split(/\s+/).filter((p) => p.length >= 2);
    if (parts.length === 0) {
      throw new Error("Owner name is too short to search the tax roll.");
    }
    const fieldClauses = OWNER_FIELDS.map((field) => {
      const andParts = parts
        .map((p) => `UPPER(${field}) LIKE UPPER('%${p}%')`)
        .join(" AND ");
      return `(${andParts})`;
    });
    return `(${fieldClauses.join(" OR ")})`;
  }

  const tokens = entitySearchTokens(query);
  if (tokens.length === 0) {
    throw new Error("Could not build a tax roll search from that owner name.");
  }

  const fieldClauses = OWNER_FIELDS.map((field) => {
    const andParts = tokens.map((p) => `UPPER(${field}) LIKE '%${p}%'`).join(" AND ");
    return `(${andParts})`;
  });
  return `(${fieldClauses.join(" OR ")})`;
}

function primaryOwnerName(attrs: GisAttributes): string {
  return (attrs.TRUE_OWNER1 ?? attrs.TRUE_OWNER2 ?? attrs.TRUE_OWNER3 ?? "").trim();
}

function ownerNames(attrs: GisAttributes): string[] {
  return [attrs.TRUE_OWNER1, attrs.TRUE_OWNER2, attrs.TRUE_OWNER3]
    .map((n) => n?.trim())
    .filter((n): n is string => !!n);
}

function buildingSqftFromAttrs(attrs: GisAttributes): number | null {
  const v = attrs.BUILDING_ACTUAL_AREA;
  if (typeof v === "number" && v > 0) return Math.round(v);
  return null;
}

function parcelMatchesQuery(
  attrs: GisAttributes,
  query: string,
  mode: MdpaSearchMode,
): boolean {
  const names = ownerNames(attrs);
  if (names.length === 0) return false;

  if (mode === "entity") {
    return names.some((name) => entityOwnerNamesMatch(query, name));
  }

  return names.some((name) => personNameMatchesOwnerField(query, name));
}

function hitFromAttributes(attrs: GisAttributes): MdpaOwnerParcelHit | null {
  const folioRaw = attrs.FOLIO?.trim();
  if (!folioRaw) return null;
  const folio = folioRaw.replace(/-/g, "").padStart(13, "0");
  const ownerName = primaryOwnerName(attrs);
  if (!ownerName) return null;

  return {
    folio,
    strap: folioToStrap(folio),
    ownerName,
    address: attrs.TRUE_SITE_ADDR?.trim() || null,
    city: attrs.TRUE_SITE_CITY?.trim() || null,
    buildingSqft: buildingSqftFromAttrs(attrs),
  };
}

async function fetchOwnerParcelsPage(
  where: string,
  outFields: string,
  offset: number,
): Promise<{
  features: { attributes: GisAttributes }[];
  exceededTransferLimit?: boolean;
}> {
  const url = new URL(MDPA_PARCELS_QUERY_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", outFields);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Miami-Dade tax roll owner search failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    features?: { attributes: GisAttributes }[];
    error?: { message: string };
    exceededTransferLimit?: boolean;
  };

  if (data.error) {
    throw new Error(`Tax roll search error: ${data.error.message}`);
  }

  return {
    features: data.features ?? [],
    exceededTransferLimit: data.exceededTransferLimit,
  };
}

/** Search Miami-Dade tax roll by owner / entity name. */
export async function searchParcelsByOwnerName(
  query: string,
  mode: MdpaSearchMode,
): Promise<MdpaOwnerParcelHit[]> {
  const where = buildOwnerWhereClause(query, mode);
  const outFields = [
    "FOLIO",
    "TRUE_OWNER1",
    "TRUE_OWNER2",
    "TRUE_OWNER3",
    "TRUE_SITE_ADDR",
    "TRUE_SITE_CITY",
    "BUILDING_ACTUAL_AREA",
  ].join(",");

  const byFolio = new Map<string, MdpaOwnerParcelHit>();
  let offset = 0;

  while (byFolio.size < MAX_PARCELS) {
    const { features, exceededTransferLimit } = await fetchOwnerParcelsPage(
      where,
      outFields,
      offset,
    );

    if (features.length === 0) break;

    for (const f of features) {
      if (!parcelMatchesQuery(f.attributes, query, mode)) continue;
      const hit = hitFromAttributes(f.attributes);
      if (hit) byFolio.set(hit.folio, hit);
    }

    offset += features.length;
    if (features.length < PAGE_SIZE) break;
    if (exceededTransferLimit && offset >= MAX_PARCELS) break;
  }

  return [...byFolio.values()].sort((a, b) =>
    (a.address ?? a.folio).localeCompare(b.address ?? b.folio),
  );
}

/** Run multiple tax roll searches and merge by folio (e.g. LLC + Sunbiz person). */
export async function searchParcelsByOwnerQueries(
  queries: { query: string; mode: MdpaSearchMode }[],
): Promise<MdpaOwnerParcelHit[]> {
  const byFolio = new Map<string, MdpaOwnerParcelHit>();
  const seen = new Set<string>();

  for (const { query, mode } of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    const key = `${mode}:${normalizeOwnerName(trimmed)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const hits = await searchParcelsByOwnerName(trimmed, mode);
    for (const hit of hits) {
      byFolio.set(hit.folio, hit);
    }
  }

  return [...byFolio.values()].sort((a, b) =>
    (a.address ?? a.folio).localeCompare(b.address ?? b.folio),
  );
}

/** Derive tax roll search mode from an owner display name. */
export function mdpaSearchModeForName(name: string): MdpaSearchMode {
  const norm = name.replace(/\./g, "");
  return /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(norm)
    ? "entity"
    : "person";
}

/** Normalize folio for CRM source_url comparison (mdpa:XX-XXXX-XXX-XXXX). */
export function folioStrapKey(strapOrFolio: string): string {
  const digits = strapOrFolio.replace(/-/g, "");
  return folioToStrap(digits.padStart(13, "0"));
}
