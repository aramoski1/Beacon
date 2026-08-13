/**
 * Tax-roll comps-lite — nearby Miami-Dade parcels with recent PA sales.
 * Not CoStar. Uses MapServer/26 for proximity + PaServicesProxy for SalesInfos.
 */

import { folioToStrap, getPropertyDetail } from "@/lib/mdpa";

const PARCELS_QUERY_URL =
  "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query";

const DEFAULT_BUFFER_FT = 2640; // 0.5 mile
const MAX_CANDIDATES = 20;
const MAX_COMPS = 8;
const MAX_DETAIL_FETCHES = 12;
const RECENT_YEARS = 7;
const DETAIL_DELAY_MS = 200;

// Tax rolls record $0/$1/$10/$100 "sales" for quitclaims, family transfers,
// and other non-arm's-length deed recordings — these are not market comps.
// Shared across all three counties (lib/bcpa-comps.ts, lib/pbcpa-comps.ts) so
// a broker sees the same sanity floor regardless of which county sourced the
// comp.
export const MIN_COMP_SALE_PRICE = 5_000;

export type TaxRollComp = {
  folio: string;
  strap: string;
  address: string | null;
  city: string | null;
  dorCode: string | null;
  dorDescription: string | null;
  sizeSqft: number | null;
  /** Land/lot size in square feet — the meaningful comp metric for land-heavy
   *  uses (open storage, yard, vacant land) where building SF understates value. */
  landSqft: number | null;
  saleDate: string | null; // ISO yyyy-mm-dd when parseable
  salePrice: number | null;
  sameDor: boolean;
  sameDorClass: boolean;
};

const SQFT_PER_ACRE = 43_560;

/** Sale price per acre — the number a broker actually prices land-heavy comps on. */
export function pricePerAcre(salePrice: number | null, landSqft: number | null): number | null {
  if (salePrice == null || landSqft == null || landSqft <= 0) return null;
  return salePrice / (landSqft / SQFT_PER_ACRE);
}

export type TaxRollCompsResult = {
  subjectFolio: string;
  subjectDor: string | null;
  comps: TaxRollComp[];
  searchedAt: string;
  note: string;
};

type GisParcelAttrs = {
  FOLIO?: string;
  TRUE_SITE_ADDR?: string;
  TRUE_SITE_CITY?: string;
  DOR_CODE_CUR?: string;
  DOR_DESC?: string;
  BUILDING_ACTUAL_AREA?: number | null;
  X_COORD?: number;
  Y_COORD?: number;
};

export type ParsedSale = {
  saleDate: string | null;
  salePrice: number | null;
  qualified: boolean;
};

/** Read PropertyInfo.LotSize (land SF) from a raw MDPA PA detail record. */
export function extractLotSize(raw: unknown): number | null {
  const d = raw as { PropertyInfo?: { LotSize?: number | string | null } };
  const v = d?.PropertyInfo?.LotSize;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** First two digits of Florida DOR code = major use class. */
export function dorMajorClass(dorCode: string | null | undefined): string | null {
  if (!dorCode) return null;
  const digits = dorCode.replace(/\D/g, "");
  if (digits.length < 2) return null;
  return digits.slice(0, 2);
}

export function sameDorClass(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = dorMajorClass(a);
  const cb = dorMajorClass(b);
  return Boolean(ca && cb && ca === cb);
}

/** Parse MDPA SalesInfos into a comparable latest sale. */
export function extractLatestSale(raw: unknown): ParsedSale | null {
  const d = raw as {
    SalesInfos?: Array<{
      DateOfSale?: string;
      SaleDate?: string;
      SalePrice?: number | string | null;
      QualifiedFlag?: string | null;
    }>;
  };
  const rows = d?.SalesInfos;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const parsed = rows
    .map((r) => {
      const dateRaw = (r.DateOfSale || r.SaleDate || "").trim();
      const saleDate = normalizeSaleDate(dateRaw);
      const salePrice =
        r.SalePrice == null || r.SalePrice === ""
          ? null
          : Number(r.SalePrice);
      const price = salePrice != null && Number.isFinite(salePrice) && salePrice > 0
        ? salePrice
        : null;
      return {
        saleDate,
        salePrice: price,
        qualified: String(r.QualifiedFlag ?? "").toUpperCase() === "Q",
        sortKey: saleDate ? Date.parse(saleDate) : 0,
      };
    })
    .filter((r) => r.saleDate || r.salePrice != null);

  if (parsed.length === 0) return null;
  parsed.sort((a, b) => b.sortKey - a.sortKey);
  const top = parsed[0];
  return {
    saleDate: top.saleDate,
    salePrice: top.salePrice,
    qualified: top.qualified,
  };
}

/** Accepts m/d/yyyy, yyyy-mm-dd, ISO → yyyy-mm-dd. */
export function normalizeSaleDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function isSaleRecent(saleDate: string | null, withinYears = RECENT_YEARS): boolean {
  if (!saleDate) return false;
  const t = Date.parse(saleDate);
  if (!Number.isFinite(t)) return false;
  const cutoff = Date.now() - withinYears * 365.25 * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

/** Prefer same DOR, then same major class, then others; dedupe by folio. */
export function rankCompCandidates(
  subjectDor: string | null,
  candidates: GisParcelAttrs[],
): GisParcelAttrs[] {
  const byFolio = new Map<string, GisParcelAttrs>();
  for (const c of candidates) {
    const folio = (c.FOLIO ?? "").replace(/\D/g, "").padStart(13, "0");
    if (!folio || folio === "0000000000000") continue;
    if (!byFolio.has(folio)) byFolio.set(folio, { ...c, FOLIO: folio });
  }

  const list = [...byFolio.values()];
  list.sort((a, b) => {
    const aExact = subjectDor && a.DOR_CODE_CUR === subjectDor ? 1 : 0;
    const bExact = subjectDor && b.DOR_CODE_CUR === subjectDor ? 1 : 0;
    if (bExact !== aExact) return bExact - aExact;
    const aClass = sameDorClass(subjectDor, a.DOR_CODE_CUR) ? 1 : 0;
    const bClass = sameDorClass(subjectDor, b.DOR_CODE_CUR) ? 1 : 0;
    if (bClass !== aClass) return bClass - aClass;
    const aSf = Number(a.BUILDING_ACTUAL_AREA) || 0;
    const bSf = Number(b.BUILDING_ACTUAL_AREA) || 0;
    return bSf - aSf;
  });
  return list;
}

async function fetchSubjectParcel(folio: string): Promise<GisParcelAttrs | null> {
  const url = new URL(PARCELS_QUERY_URL);
  url.searchParams.set("where", `FOLIO='${folio}'`);
  url.searchParams.set(
    "outFields",
    "FOLIO,TRUE_SITE_ADDR,TRUE_SITE_CITY,DOR_CODE_CUR,DOR_DESC,BUILDING_ACTUAL_AREA,X_COORD,Y_COORD",
  );
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString(), {
    next: { revalidate: 86400 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GIS subject lookup failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: { attributes: GisParcelAttrs }[];
    error?: { message: string };
  };
  if (data.error) throw new Error(`GIS error: ${data.error.message}`);
  return data.features?.[0]?.attributes ?? null;
}

async function fetchNearbyParcels(
  x: number,
  y: number,
  subjectFolio: string,
  subjectDor: string | null,
  bufferFt: number,
): Promise<GisParcelAttrs[]> {
  const envelope = `${x - bufferFt},${y - bufferFt},${x + bufferFt},${y + bufferFt}`;

  async function query(where: string): Promise<GisParcelAttrs[]> {
    const url = new URL(PARCELS_QUERY_URL);
    url.searchParams.set("geometry", envelope);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "102658");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("where", where);
    url.searchParams.set(
      "outFields",
      "FOLIO,TRUE_SITE_ADDR,TRUE_SITE_CITY,DOR_CODE_CUR,DOR_DESC,BUILDING_ACTUAL_AREA",
    );
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultRecordCount", String(MAX_CANDIDATES));
    url.searchParams.set("f", "json");
    const res = await fetch(url.toString(), {
      next: { revalidate: 86400 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`GIS nearby query failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      features?: { attributes: GisParcelAttrs }[];
      error?: { message: string };
    };
    if (data.error) throw new Error(`GIS error: ${data.error.message}`);
    return (data.features ?? []).map((f) => f.attributes);
  }

  const exclude = `FOLIO<>'${subjectFolio}'`;
  let rows: GisParcelAttrs[] = [];

  if (subjectDor) {
    rows = await query(`DOR_CODE_CUR='${subjectDor}' AND ${exclude}`);
  }
  if (rows.length < 5) {
    const major = dorMajorClass(subjectDor);
    if (major) {
      const more = await query(`DOR_CODE_CUR LIKE '${major}%' AND ${exclude}`);
      rows = [...rows, ...more];
    }
  }
  if (rows.length < 5) {
    const more = await query(exclude);
    rows = [...rows, ...more];
  }

  return rankCompCandidates(subjectDor, rows).slice(0, MAX_CANDIDATES);
}

/**
 * Build tax-roll comps for a 13-digit subject folio.
 * Rate-limits PA detail fetches; returns only parcels with a recent sale.
 */
export async function fetchTaxRollComps(
  subjectFolioRaw: string,
  opts?: { bufferFt?: number },
): Promise<TaxRollCompsResult> {
  const subjectFolio = subjectFolioRaw.replace(/\D/g, "").padStart(13, "0");
  const bufferFt = opts?.bufferFt ?? DEFAULT_BUFFER_FT;

  const subject = await fetchSubjectParcel(subjectFolio);
  if (!subject?.X_COORD || !subject?.Y_COORD) {
    return {
      subjectFolio,
      subjectDor: subject?.DOR_CODE_CUR ?? null,
      comps: [],
      searchedAt: new Date().toISOString(),
      note: "Subject parcel not found in Miami-Dade GIS — comps unavailable.",
    };
  }

  const subjectDor = subject.DOR_CODE_CUR ?? null;
  const nearby = await fetchNearbyParcels(
    subject.X_COORD,
    subject.Y_COORD,
    subjectFolio,
    subjectDor,
    bufferFt,
  );

  const comps: TaxRollComp[] = [];
  const toFetch = nearby.slice(0, MAX_DETAIL_FETCHES);

  for (let i = 0; i < toFetch.length; i++) {
    const cand = toFetch[i];
    const folio = (cand.FOLIO ?? "").replace(/\D/g, "").padStart(13, "0");
    if (!folio) continue;

    let sale: ParsedSale | null = null;
    let landSqft: number | null = null;
    try {
      const detail = await getPropertyDetail(folioToStrap(folio));
      sale = extractLatestSale(detail);
      landSqft = extractLotSize(detail);
    } catch {
      sale = null;
    }

    if (sale && isSaleRecent(sale.saleDate) && sale.salePrice != null && sale.salePrice >= MIN_COMP_SALE_PRICE) {
      comps.push({
        folio,
        strap: folioToStrap(folio),
        address: cand.TRUE_SITE_ADDR?.trim() || null,
        city: cand.TRUE_SITE_CITY?.trim() || null,
        dorCode: cand.DOR_CODE_CUR ?? null,
        dorDescription: cand.DOR_DESC ?? null,
        sizeSqft:
          cand.BUILDING_ACTUAL_AREA != null && Number(cand.BUILDING_ACTUAL_AREA) > 0
            ? Number(cand.BUILDING_ACTUAL_AREA)
            : null,
        landSqft,
        saleDate: sale.saleDate,
        salePrice: sale.salePrice,
        sameDor: Boolean(subjectDor && cand.DOR_CODE_CUR === subjectDor),
        sameDorClass: sameDorClass(subjectDor, cand.DOR_CODE_CUR),
      });
    }

    if (comps.length >= MAX_COMPS) break;
    if (i < toFetch.length - 1) {
      await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
    }
  }

  comps.sort((a, b) => {
    if (b.sameDor !== a.sameDor) return Number(b.sameDor) - Number(a.sameDor);
    if (b.sameDorClass !== a.sameDorClass) return Number(b.sameDorClass) - Number(a.sameDorClass);
    return Date.parse(b.saleDate ?? "") - Date.parse(a.saleDate ?? "");
  });

  return {
    subjectFolio,
    subjectDor,
    comps: comps.slice(0, MAX_COMPS),
    searchedAt: new Date().toISOString(),
    note:
      comps.length === 0
        ? "No nearby tax-roll parcels with a recent recorded sale were found in the search radius. This is public PA data — not CoStar comps."
        : "Tax-roll comps from Miami-Dade Property Appraiser (not CoStar). Same DOR/use class preferred when available.",
  };
}

/** Extract 13-digit folio from properties.source_url like mdpa:01-3125-078-0010. */
export function folioFromMdpaSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl?.startsWith("mdpa:")) return null;
  const raw = sourceUrl.slice(5).replace(/\D/g, "");
  if (raw.length < 10) return null;
  return raw.padStart(13, "0");
}
