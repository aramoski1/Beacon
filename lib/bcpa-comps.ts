/**
 * Broward tax-roll comps-lite — same-city, same-DOR-class Broward parcels
 * with a recent recorded sale. Not CoStar.
 *
 * Unlike Miami-Dade (lib/mdpa-comps.ts), which needs a GIS proximity query
 * plus a second PA detail fetch per candidate for SalesInfos, Broward's own
 * parcel FeatureServer carries SALE_YR1/SALE_MO1/SALE_PRC1/DOR_UC/
 * TOT_LVG_AREA directly on every record — one query returns everything
 * needed, no per-parcel detail fetch.
 *
 * That FeatureServer does carry real polygon geometry (unlike Palm Beach's
 * non-spatial PAO.PROPINFO_PUB table — see lib/pbcpa-comps.ts), so a true
 * radius search is technically possible here. Matching by same city + same
 * DOR/use class instead keeps the two non-Miami-Dade counties on one
 * consistent, honestly-labeled methodology rather than a true-radius search
 * for one and a city-wide fallback for the other.
 */

import { folioToStrap, type BCPARecord } from "@/lib/bcpa";
import {
  sameDorClass,
  isSaleRecent,
  MIN_COMP_SALE_PRICE,
  type TaxRollComp,
  type TaxRollCompsResult,
} from "@/lib/mdpa-comps";

const BCPA_URL =
  "https://services5.arcgis.com/wI5GZmCtnUU8ueya/arcgis/rest/services/Broward_County_Parcel_Boundary/FeatureServer/1/query";

const OUT_FIELDS = "PARCELNO,PHY_ADDR1,PHY_CITY,DOR_UC,TOT_LVG_AREA,LND_SQFOOT,SALE_PRC1,SALE_YR1,SALE_MO1";
const CANDIDATE_RECORD_COUNT = 200;
const MAX_COMPS = 8;

function bcpaSaleDate(yr: number | null | undefined, mo: string | number | null | undefined): string | null {
  if (!yr) return null;
  return `${yr}-${String(mo ?? "01").padStart(2, "0")}-01`;
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

async function fetchSubjectRecord(folio: string): Promise<BCPARecord | null> {
  const url = new URL(BCPA_URL);
  url.searchParams.set("where", `PARCELNO='${folio}'`);
  url.searchParams.set(
    "outFields",
    "PARCELNO,OWN_NAME,PHY_ADDR1,PHY_CITY,DOR_UC,PA_UC,TOT_LVG_AREA,SALE_PRC1,SALE_YR1,SALE_MO1",
  );
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "1");
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString(), {
    next: { revalidate: 86400 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`BCPA subject lookup failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: { attributes: BCPARecord }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  return data.features?.[0]?.attributes ?? null;
}

type BcpaCompAttrs = {
  PARCELNO?: string;
  PHY_ADDR1?: string | null;
  PHY_CITY?: string | null;
  DOR_UC?: string | null;
  TOT_LVG_AREA?: number | null;
  LND_SQFOOT?: number | null;
  SALE_PRC1?: number | null;
  SALE_YR1?: number | null;
  SALE_MO1?: string | number | null;
};

async function fetchSameCityParcels(city: string, excludeFolio: string): Promise<BcpaCompAttrs[]> {
  const url = new URL(BCPA_URL);
  url.searchParams.set(
    "where",
    `UPPER(PHY_CITY)=UPPER('${escapeSqlLiteral(city)}') AND PARCELNO<>'${excludeFolio}'`,
  );
  url.searchParams.set("outFields", OUT_FIELDS);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", String(CANDIDATE_RECORD_COUNT));
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString(), {
    next: { revalidate: 86400 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`BCPA comps query failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: { attributes: BcpaCompAttrs }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  return (data.features ?? []).map((f) => f.attributes);
}

/** Build tax-roll comps for a Broward folio (dashed strap or undashed PARCELNO). */
export async function fetchBcpaTaxRollComps(subjectFolioRaw: string): Promise<TaxRollCompsResult> {
  const subjectFolio = subjectFolioRaw.replace(/-/g, "").padStart(12, "0");

  const subject = await fetchSubjectRecord(subjectFolio);
  if (!subject) {
    return {
      subjectFolio,
      subjectDor: null,
      comps: [],
      searchedAt: new Date().toISOString(),
      note: "Subject parcel not found in Broward GIS — comps unavailable.",
    };
  }

  const subjectDor = subject.DOR_UC ?? subject.PA_UC ?? null;
  const city = subject.PHY_CITY?.trim();
  if (!city) {
    return {
      subjectFolio,
      subjectDor,
      comps: [],
      searchedAt: new Date().toISOString(),
      note: "Subject parcel has no city on file in Broward GIS — comps unavailable.",
    };
  }

  const candidates = await fetchSameCityParcels(city, subjectFolio);

  const comps: TaxRollComp[] = candidates
    .map((cand) => {
      const saleDate = bcpaSaleDate(cand.SALE_YR1, cand.SALE_MO1);
      const salePrice =
        cand.SALE_PRC1 != null && Number(cand.SALE_PRC1) > 0 ? Number(cand.SALE_PRC1) : null;
      const folio = (cand.PARCELNO ?? "").replace(/-/g, "").padStart(12, "0");
      if (!folio || !isSaleRecent(saleDate) || salePrice == null || salePrice < MIN_COMP_SALE_PRICE) return null;
      const comp: TaxRollComp = {
        folio,
        strap: folioToStrap(folio),
        address: cand.PHY_ADDR1?.trim() || null,
        city: cand.PHY_CITY?.trim() || null,
        dorCode: cand.DOR_UC ?? null,
        dorDescription: null,
        sizeSqft:
          cand.TOT_LVG_AREA != null && Number(cand.TOT_LVG_AREA) > 0 ? Number(cand.TOT_LVG_AREA) : null,
        landSqft:
          cand.LND_SQFOOT != null && Number(cand.LND_SQFOOT) > 0 ? Number(cand.LND_SQFOOT) : null,
        saleDate,
        salePrice,
        sameDor: Boolean(subjectDor && cand.DOR_UC === subjectDor),
        sameDorClass: sameDorClass(subjectDor, cand.DOR_UC),
      };
      return comp;
    })
    .filter((c): c is TaxRollComp => c !== null);

  comps.sort((a, b) => {
    if (b.sameDor !== a.sameDor) return Number(b.sameDor) - Number(a.sameDor);
    if (b.sameDorClass !== a.sameDorClass) return Number(b.sameDorClass) - Number(a.sameDorClass);
    return (b.sizeSqft ?? 0) - (a.sizeSqft ?? 0);
  });

  return {
    subjectFolio,
    subjectDor,
    comps: comps.slice(0, MAX_COMPS),
    searchedAt: new Date().toISOString(),
    note:
      comps.length === 0
        ? "No Broward parcels in the same city with a recent recorded sale were found. This is public PA data — not CoStar comps."
        : "Tax-roll comps from Broward Property Appraiser (not CoStar) — same city, same DOR/use class preferred when available. Not a radius search.",
  };
}

/** Extract undashed 12-digit folio from properties.source_url like bcpa:51-4209-05-1449. */
export function folioFromBcpaSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl?.startsWith("bcpa:")) return null;
  const raw = sourceUrl.slice(5).replace(/\D/g, "");
  if (raw.length < 8) return null;
  return raw.padStart(12, "0");
}
