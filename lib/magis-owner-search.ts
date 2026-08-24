// Massachusetts tax roll owner search via the same statewide
// Massachusetts_Property_Tax_Parcels FeatureServer used for address search
// (see lib/magis.ts). Used by owner portfolio to discover statewide holdings,
// not just CRM rows — same purpose as lib/mdpa-owner-search.ts, lib/bcpa.ts's
// owner search, lib/pbcpa.ts's searchParcelsByOwnerName.
//
// This is NOT Sunbiz. It never leaves MassGIS's own parcel data — matching
// OWNER1 against a name the broker already has, the same way the Florida
// tax-roll owner searches match OWN_NAME/OWNER_NAME1/TRUE_OWNER1. Entity
// registry lookup (finding a corp's registered agent/officers) is a
// different, Florida-only feature (lib/sunbiz.ts) that does not apply here —
// see lib/magis.ts's file header and app/properties/[id]/actions.ts's
// lookupSunbiz guard.

import { normalizeOwnerName, personNameMatchesOwnerField } from "@/lib/owner-contacts";
import { entityOwnerNamesMatch } from "./mdpa-owner-search";

const MAGIS_URL =
  "https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query";

const OWNER_SEARCH_FIELDS = "LOC_ID,SITE_ADDR,CITY,OWNER1,BLD_AREA,RES_AREA";
const PAGE_SIZE = 1000;
const MAX_PARCELS = 3000;

export type MagisSearchMode = "entity" | "person";

export type MagisOwnerParcelHit = {
  folio: string;
  strap: string;
  ownerName: string;
  address: string | null;
  city: string | null;
  buildingSqft: number | null;
};

type OwnerSearchAttributes = {
  LOC_ID?: string;
  SITE_ADDR?: string | null;
  CITY?: string | null;
  OWNER1?: string | null;
  BLD_AREA?: number | null;
  RES_AREA?: number | null;
};

const ENTITY_STOP_WORDS = new Set([
  "LLC", "INC", "CORP", "LP", "LLP", "LLLP", "LTD", "CO", "PA", "PL", "PLLC",
  "THE", "AND", "OF", "A", "MA", "MASSACHUSETTS",
]);

function sanitizeLikeToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
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

function buildOwnerWhereClause(query: string, mode: MagisSearchMode): string {
  const safe = sanitizeLikeToken(query);
  if (safe.length < 2) {
    throw new Error("Owner name is too short to search the tax roll.");
  }

  if (mode === "person") {
    const parts = safe.split(/\s+/).filter((p) => p.length >= 2);
    if (parts.length === 0) {
      throw new Error("Owner name is too short to search the tax roll.");
    }
    const andParts = parts.map((p) => `UPPER(OWNER1) LIKE UPPER('%${p}%')`).join(" AND ");
    return `(${andParts})`;
  }

  const tokens = entitySearchTokens(query);
  if (tokens.length === 0) {
    throw new Error("Could not build a tax roll search from that owner name.");
  }
  const andParts = tokens.map((p) => `UPPER(OWNER1) LIKE '%${p}%'`).join(" AND ");
  return `(${andParts})`;
}

function ownerParcelMatchesQuery(
  attrs: OwnerSearchAttributes,
  query: string,
  mode: MagisSearchMode,
): boolean {
  const name = attrs.OWNER1?.trim();
  if (!name) return false;
  return mode === "entity" ? entityOwnerNamesMatch(query, name) : personNameMatchesOwnerField(query, name);
}

function hitFromOwnerAttributes(attrs: OwnerSearchAttributes): MagisOwnerParcelHit | null {
  const locId = attrs.LOC_ID?.trim();
  if (!locId) return null;
  const ownerName = attrs.OWNER1?.trim();
  if (!ownerName) return null;

  const sizeSqft = attrs.BLD_AREA || attrs.RES_AREA || null;
  return {
    folio: locId,
    strap: locId, // no raw/display split for MA's LOC_ID — see lib/magis.ts
    ownerName,
    address: attrs.SITE_ADDR?.trim() || null,
    city: attrs.CITY?.trim() || null,
    buildingSqft: sizeSqft && sizeSqft > 0 ? sizeSqft : null,
  };
}

async function fetchOwnerParcelsPage(
  where: string,
  offset: number,
): Promise<{ features: { attributes: OwnerSearchAttributes }[]; exceededTransferLimit?: boolean }> {
  const url = new URL(MAGIS_URL);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", OWNER_SEARCH_FIELDS);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID");
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Massachusetts tax roll owner search failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    features?: { attributes: OwnerSearchAttributes }[];
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

/** Search the Massachusetts tax roll by owner / entity name (OWNER1). */
export async function searchParcelsByOwnerName(
  query: string,
  mode: MagisSearchMode,
): Promise<MagisOwnerParcelHit[]> {
  const where = buildOwnerWhereClause(query, mode);

  // Dedupe by folio (LOC_ID) as results come in — the same complex-wide
  // wrinkle as lib/magis-comps.ts (many SITE_ADDR unit rows can share one
  // LOC_ID), so this also naturally collapses those into a single hit.
  const byFolio = new Map<string, MagisOwnerParcelHit>();
  let offset = 0;

  while (byFolio.size < MAX_PARCELS) {
    const { features, exceededTransferLimit } = await fetchOwnerParcelsPage(where, offset);
    if (features.length === 0) break;

    for (const f of features) {
      if (!ownerParcelMatchesQuery(f.attributes, query, mode)) continue;
      const hit = hitFromOwnerAttributes(f.attributes);
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

/** Run multiple tax roll owner searches and merge by folio. */
export async function searchParcelsByOwnerQueries(
  queries: { query: string; mode: MagisSearchMode }[],
): Promise<MagisOwnerParcelHit[]> {
  const byFolio = new Map<string, MagisOwnerParcelHit>();
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

/** Normalize a LOC_ID for CRM source_url comparison (magis:F_xxxxxx_xxxxxx) — trivial, since LOC_ID has no raw/display split. */
export function folioStrapKey(strapOrFolio: string): string {
  return strapOrFolio.trim();
}
