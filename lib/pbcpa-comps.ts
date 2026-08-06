/**
 * Palm Beach tax-roll comps-lite — same-municipality, same-use-class Palm
 * Beach parcels with a recent recorded sale. Not CoStar.
 *
 * PAO.PROPINFO_PUB (see lib/pbcpa.ts) is a non-spatial table — no geometry
 * field exists, so a radius/proximity search (as used for Miami-Dade in
 * lib/mdpa-comps.ts) is not possible here. Matching by same municipality +
 * same classified property type is the same fallback used for Broward (see
 * lib/bcpa-comps.ts) for consistency, even though Broward's own service does
 * carry geometry. Palm Beach also has no numeric DOR code (PROPERTY_USE is
 * free text — see propertyUseToType) — "same use class" here means the same
 * classified bucket (industrial/office/retail/etc.), not a DOR major-class
 * match. Sale price/date/use are all on the same row, so — like Broward and
 * unlike Miami-Dade — one query returns everything needed.
 */

import {
  folioToStrap,
  propertyUseToType,
  pbSaleDate,
  type PBRecord,
} from "@/lib/pbcpa";
import {
  isSaleRecent,
  MIN_COMP_SALE_PRICE,
  type TaxRollComp,
  type TaxRollCompsResult,
} from "@/lib/mdpa-comps";

const PBCPA_URL =
  "https://maps.co.palm-beach.fl.us/arcgis/rest/services/Parcels/labels/MapServer/1/query";

const SUBJECT_FIELDS = "PARCEL_NUMBER,SITE_ADDR_STR,MUNICIPALITY,PROPERTY_USE,PRICE,SALE_DATE";
const COMP_FIELDS = "PARCEL_NUMBER,SITE_ADDR_STR,MUNICIPALITY,PROPERTY_USE,PRICE,SALE_DATE";
const CANDIDATE_RECORD_COUNT = 200;
const MAX_COMPS = 8;

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

async function fetchSubjectRecord(folio: string): Promise<PBRecord | null> {
  const url = new URL(PBCPA_URL);
  url.searchParams.set("where", `PARCEL_NUMBER='${folio}'`);
  url.searchParams.set("outFields", SUBJECT_FIELDS);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID");
  url.searchParams.set("resultRecordCount", "1");
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString(), {
    next: { revalidate: 86400 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`PBCPA subject lookup failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: { attributes: PBRecord }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  return data.features?.[0]?.attributes ?? null;
}

type PbcpaCompAttrs = {
  PARCEL_NUMBER?: string;
  SITE_ADDR_STR?: string | null;
  MUNICIPALITY?: string | null;
  PROPERTY_USE?: string | null;
  PRICE?: number | null;
  SALE_DATE?: number | null;
};

async function fetchSameMunicipalityParcels(
  municipality: string,
  excludeFolio: string,
): Promise<PbcpaCompAttrs[]> {
  const url = new URL(PBCPA_URL);
  url.searchParams.set(
    "where",
    `UPPER(MUNICIPALITY)=UPPER('${escapeSqlLiteral(municipality)}') AND PARCEL_NUMBER<>'${excludeFolio}'`,
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
  if (!res.ok) throw new Error(`PBCPA comps query failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: { attributes: PbcpaCompAttrs }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  return (data.features ?? []).map((f) => f.attributes);
}

/** Build tax-roll comps for a Palm Beach PCN (dashed strap or undashed digit string). */
export async function fetchPbcpaTaxRollComps(subjectFolioRaw: string): Promise<TaxRollCompsResult> {
  const subjectFolio = subjectFolioRaw.replace(/-/g, "").padStart(17, "0");

  const subject = await fetchSubjectRecord(subjectFolio);
  if (!subject) {
    return {
      subjectFolio,
      subjectDor: null,
      comps: [],
      searchedAt: new Date().toISOString(),
      note: "Subject parcel not found in Palm Beach GIS — comps unavailable.",
    };
  }

  const subjectUse = subject.PROPERTY_USE ?? null;
  const subjectType = propertyUseToType(subjectUse);
  const municipality = subject.MUNICIPALITY?.trim();
  if (!municipality) {
    return {
      subjectFolio,
      subjectDor: subjectUse,
      comps: [],
      searchedAt: new Date().toISOString(),
      note: "Subject parcel has no municipality on file in Palm Beach GIS — comps unavailable.",
    };
  }

  const candidates = await fetchSameMunicipalityParcels(municipality, subjectFolio);

  const comps: TaxRollComp[] = candidates
    .map((cand) => {
      const saleDate = pbSaleDate(cand.SALE_DATE);
      const salePrice = cand.PRICE != null && Number(cand.PRICE) > 0 ? Number(cand.PRICE) : null;
      const folio = (cand.PARCEL_NUMBER ?? "").replace(/-/g, "");
      if (!folio || !isSaleRecent(saleDate) || salePrice == null || salePrice < MIN_COMP_SALE_PRICE) return null;
      const candType = propertyUseToType(cand.PROPERTY_USE);
      const sameClass = candType === subjectType;
      const comp: TaxRollComp = {
        folio,
        strap: folioToStrap(folio),
        address: cand.SITE_ADDR_STR?.trim() || null,
        city: cand.MUNICIPALITY?.trim() || null,
        dorCode: null,
        dorDescription: cand.PROPERTY_USE ?? null,
        sizeSqft: null,
        saleDate,
        salePrice,
        sameDor: sameClass && cand.PROPERTY_USE === subjectUse,
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
        ? "No Palm Beach parcels in the same municipality with a recent recorded sale were found. This is public PA data — not CoStar comps."
        : "Tax-roll comps from Palm Beach Property Appraiser (not CoStar) — same municipality, same property-use class preferred when available. Not a radius search.",
  };
}

/** Extract undashed 17-digit PCN from properties.source_url like pbcpa:08-43-45-29-01-019-0251. */
export function folioFromPbcpaSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl?.startsWith("pbcpa:")) return null;
  const raw = sourceUrl.slice(6).replace(/\D/g, "");
  if (raw.length < 10) return null;
  return raw.padStart(17, "0");
}
