/**
 * Massachusetts tax-roll comps-lite — same-town, same-use-class parcels with
 * a recent recorded sale. Not CoStar.
 *
 * Massachusetts_Property_Tax_Parcels (see lib/magis.ts) DOES carry real
 * polygon geometry (Shape__Area/Shape__Length confirmed on every live
 * record), so a true radius search is technically possible — but matching
 * by same city/town + same use-class instead keeps this consistent with
 * Broward and Palm Beach's own methodology (lib/bcpa-comps.ts,
 * lib/pbcpa-comps.ts: "not a radius search", chosen for one honest,
 * consistent approach across every non-Miami-Dade source rather than a
 * true-radius search for some and a fallback for others). MassGIS is ALSO
 * one shared table spanning many towns — same-town is the natural analog to
 * Broward/Palm Beach's same-city, not a downgrade.
 *
 * Sale price/date/use/value/size are all on the same row (SITE_ADDR, CITY,
 * USE_DESC, TOTAL_VAL/LAND_VAL/BLDG_VAL, BLD_AREA/RES_AREA, LOT_SIZE,
 * LS_DATE, LS_PRICE) — one query returns everything needed, same as
 * Broward, no per-candidate detail fetch.
 *
 * One MA-specific wrinkle, confirmed live (see tests/lib/magis-comps.test.ts
 * and the "One Westinghouse Plaza" case in tests/lib/magis.test.ts): a single
 * parcel can have many SITE_ADDR rows sharing one LOC_ID (condo units,
 * numbered parking spaces). Candidates are deduped by LOC_ID before ranking,
 * so a large condo/office complex can't flood the comp list with what is
 * really one sale event repeated under many unit rows.
 */

import {
  propertyTypeFromUseDesc,
  maSaleDate,
  type MARecord,
} from "@/lib/magis";
import {
  isSaleRecent,
  MIN_COMP_SALE_PRICE,
  type TaxRollComp,
  type TaxRollCompsResult,
} from "@/lib/mdpa-comps";

const MAGIS_URL =
  "https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query";

const SUBJECT_FIELDS = "LOC_ID,SITE_ADDR,CITY,USE_DESC,LS_PRICE,LS_DATE";
const COMP_FIELDS = "LOC_ID,SITE_ADDR,CITY,USE_DESC,LS_PRICE,LS_DATE,BLD_AREA,RES_AREA,LOT_SIZE,LOT_UNITS";
const CANDIDATE_RECORD_COUNT = 200;
const MAX_COMPS = 8;

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

async function fetchSubjectRecord(locId: string): Promise<MARecord | null> {
  const url = new URL(MAGIS_URL);
  url.searchParams.set("where", `LOC_ID='${escapeSqlLiteral(locId)}'`);
  url.searchParams.set("outFields", SUBJECT_FIELDS);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "1");
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString(), {
    next: { revalidate: 86400 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`MassGIS subject lookup failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: { attributes: MARecord }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  return data.features?.[0]?.attributes ?? null;
}

type MagisCompAttrs = {
  LOC_ID?: string;
  SITE_ADDR?: string | null;
  CITY?: string | null;
  USE_DESC?: string | null;
  LS_PRICE?: number | null;
  LS_DATE?: string | null;
  BLD_AREA?: number | null;
  RES_AREA?: number | null;
  LOT_SIZE?: number | null;
  LOT_UNITS?: string | null;
};

async function fetchSameTownParcels(city: string, excludeLocId: string): Promise<MagisCompAttrs[]> {
  const url = new URL(MAGIS_URL);
  url.searchParams.set(
    "where",
    `UPPER(CITY)=UPPER('${escapeSqlLiteral(city)}') AND LOC_ID<>'${escapeSqlLiteral(excludeLocId)}'`,
  );
  url.searchParams.set("outFields", COMP_FIELDS);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID");
  url.searchParams.set("resultRecordCount", String(CANDIDATE_RECORD_COUNT));
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString(), {
    next: { revalidate: 86400 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`MassGIS comps query failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: { attributes: MagisCompAttrs }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  return (data.features ?? []).map((f) => f.attributes);
}

/** Build tax-roll comps for a Massachusetts LOC_ID. */
export async function fetchMagisTaxRollComps(subjectLocId: string): Promise<TaxRollCompsResult> {
  const subjectFolio = subjectLocId.trim();

  const subject = await fetchSubjectRecord(subjectFolio);
  if (!subject) {
    return {
      subjectFolio,
      subjectDor: null,
      comps: [],
      searchedAt: new Date().toISOString(),
      note: "Subject parcel not found in MassGIS — comps unavailable.",
    };
  }

  const subjectUse = subject.USE_DESC ?? null;
  const subjectType = propertyTypeFromUseDesc(subjectUse);
  const city = subject.CITY?.trim();
  if (!city) {
    return {
      subjectFolio,
      subjectDor: subjectUse,
      comps: [],
      searchedAt: new Date().toISOString(),
      note: "Subject parcel has no city/town on file in MassGIS — comps unavailable.",
    };
  }

  const candidates = await fetchSameTownParcels(city, subjectFolio);

  // Dedupe by LOC_ID first (see file header — one parcel, many unit rows)
  // before ranking, so a large complex doesn't dominate the comp list with
  // what is really one sale repeated under many SITE_ADDR variants.
  const byLocId = new Map<string, MagisCompAttrs>();
  for (const cand of candidates) {
    const locId = cand.LOC_ID?.trim();
    if (locId && !byLocId.has(locId)) byLocId.set(locId, cand);
  }

  const comps: TaxRollComp[] = [...byLocId.values()]
    .map((cand) => {
      const saleDate = maSaleDate(cand.LS_DATE);
      const salePrice = cand.LS_PRICE != null && Number(cand.LS_PRICE) > 0 ? Number(cand.LS_PRICE) : null;
      const locId = cand.LOC_ID?.trim();
      if (!locId || !isSaleRecent(saleDate) || salePrice == null || salePrice < MIN_COMP_SALE_PRICE) return null;
      const candType = propertyTypeFromUseDesc(cand.USE_DESC);
      const sameClass = candType === subjectType;
      const sizeSqft = cand.BLD_AREA || cand.RES_AREA || null;
      const lotSize = cand.LOT_SIZE;
      const comp: TaxRollComp = {
        folio: locId,
        strap: locId,
        address: cand.SITE_ADDR?.trim() || null,
        city: cand.CITY?.trim() || null,
        dorCode: null,
        dorDescription: cand.USE_DESC ?? null,
        sizeSqft: sizeSqft && sizeSqft > 0 ? sizeSqft : null,
        landSqft: typeof lotSize === "number" && lotSize > 0 && cand.LOT_UNITS === "Acres" ? Math.round(lotSize * 43_560) : null,
        saleDate,
        salePrice,
        sameDor: sameClass && cand.USE_DESC === subjectUse,
        sameDorClass: sameClass,
      };
      return comp;
    })
    .filter((c): c is TaxRollComp => c !== null);

  comps.sort((a, b) => {
    if (b.sameDor !== a.sameDor) return Number(b.sameDor) - Number(a.sameDor);
    if (b.sameDorClass !== a.sameDorClass) return Number(b.sameDorClass) - Number(a.sameDorClass);
    return Date.parse(b.saleDate ?? "") - Date.parse(a.saleDate ?? "");
  });

  return {
    subjectFolio,
    subjectDor: subjectUse,
    comps: comps.slice(0, MAX_COMPS),
    searchedAt: new Date().toISOString(),
    note:
      comps.length === 0
        ? "No Massachusetts parcels in the same city/town with a recent recorded sale were found. This is public MassGIS data — not CoStar comps."
        : "Tax-roll comps from MassGIS (not CoStar) — same city/town, same use-class preferred when available. Not a radius search.",
  };
}

/** Extract LOC_ID from properties.source_url like magis:F_790618_2965662. */
export function folioFromMagisSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl?.startsWith("magis:")) return null;
  const raw = sourceUrl.slice(6).trim();
  return raw || null;
}
