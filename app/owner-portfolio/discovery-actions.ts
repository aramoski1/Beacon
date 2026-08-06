"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizeAddress } from "@/lib/property-ingest";
import {
  folioStrapKey,
  mdpaSearchModeForName,
  searchParcelsByOwnerQueries,
  type MdpaOwnerParcelHit,
  type MdpaSearchMode,
} from "@/lib/mdpa-owner-search";
import { importTaxRollFolio } from "@/lib/mdpa-folio-ingest";
import {
  folioToStrap as bcpaFolioToStrap,
  searchParcelsByOwnerQueries as searchBcpaParcelsByOwnerQueries,
  type BcpaOwnerParcelHit,
  type BcpaSearchMode,
} from "@/lib/bcpa";
import { importBcpaFolio } from "@/lib/bcpa-folio-ingest";
import {
  folioToStrap as pbcpaFolioToStrap,
  searchParcelsByOwnerQueries as searchPbcpaParcelsByOwnerQueries,
  type PbcpaOwnerParcelHit,
  type PbcpaSearchMode,
} from "@/lib/pbcpa";
import { importPbcpaFolio } from "@/lib/pbcpa-folio-ingest";

export type MdpaPortfolioParcel = MdpaOwnerParcelHit & {
  inCrm: boolean;
  crmPropertyId: string | null;
};

export type MdpaPortfolioDiscovery = {
  queries: { query: string; mode: MdpaSearchMode; label?: string }[];
  parcels: MdpaPortfolioParcel[];
  totalOnTaxRoll: number;
  inCrmCount: number;
  notInCrmCount: number;
  truncated: boolean;
  error?: string;
};

export type BcpaPortfolioParcel = BcpaOwnerParcelHit & {
  inCrm: boolean;
  crmPropertyId: string | null;
};

export type BcpaPortfolioDiscovery = {
  queries: { query: string; mode: BcpaSearchMode; label?: string }[];
  parcels: BcpaPortfolioParcel[];
  totalOnTaxRoll: number;
  inCrmCount: number;
  notInCrmCount: number;
  truncated: boolean;
  error?: string;
};

export type PbcpaPortfolioParcel = PbcpaOwnerParcelHit & {
  inCrm: boolean;
  crmPropertyId: string | null;
};

export type PbcpaPortfolioDiscovery = {
  queries: { query: string; mode: PbcpaSearchMode; label?: string }[];
  parcels: PbcpaPortfolioParcel[];
  totalOnTaxRoll: number;
  inCrmCount: number;
  notInCrmCount: number;
  truncated: boolean;
  error?: string;
};

/** Loads folio→property and address→property maps for a given CRM source_url prefix (e.g. "mdpa:", "bcpa:"). */
async function loadCrmMatchMaps(
  userId: string,
  sourcePrefix: "mdpa:" | "bcpa:" | "pbcpa:",
  normalizeFolioKey: (raw: string) => string,
): Promise<{
  folioMap: Map<string, string>;
  addressMap: Map<string, string>;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("id, source_url, address")
    .eq("owner_id", userId);

  const folioMap = new Map<string, string>();
  const addressMap = new Map<string, string>();

  for (const row of data ?? []) {
    if (row.source_url?.startsWith(sourcePrefix)) {
      folioMap.set(normalizeFolioKey(row.source_url.slice(sourcePrefix.length)), row.id);
    }
    if (row.address?.trim()) {
      addressMap.set(normalizeAddress(row.address), row.id);
    }
  }

  return { folioMap, addressMap };
}

function attachCrmStatus<T extends { strap: string; address: string | null }>(
  hits: T[],
  folioMap: Map<string, string>,
  addressMap: Map<string, string>,
): (T & { inCrm: boolean; crmPropertyId: string | null })[] {
  return hits.map((hit) => {
    let crmPropertyId = folioMap.get(hit.strap) ?? null;
    if (!crmPropertyId && hit.address?.trim()) {
      crmPropertyId = addressMap.get(normalizeAddress(hit.address)) ?? null;
    }
    return {
      ...hit,
      inCrm: crmPropertyId != null,
      crmPropertyId,
    };
  });
}

export async function discoverMdpaPortfolio(
  queries: { query: string; mode: MdpaSearchMode; label?: string }[],
): Promise<MdpaPortfolioDiscovery> {
  const normalizedQueries = queries
    .map((q) => ({ ...q, query: q.query.trim() }))
    .filter((q) => q.query.length >= 2);

  if (normalizedQueries.length === 0) {
    return {
      queries: [],
      parcels: [],
      totalOnTaxRoll: 0,
      inCrmCount: 0,
      notInCrmCount: 0,
      truncated: false,
      error: "No owner name to search.",
    };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return {
        queries: normalizedQueries,
        parcels: [],
        totalOnTaxRoll: 0,
        inCrmCount: 0,
        notInCrmCount: 0,
        truncated: false,
        error: "Not authenticated.",
      };
    }

    const hits = await searchParcelsByOwnerQueries(
      normalizedQueries.map((q) => ({ query: q.query, mode: q.mode })),
    );
    const { folioMap, addressMap } = await loadCrmMatchMaps(user.id, "mdpa:", folioStrapKey);
    const parcels = attachCrmStatus(hits, folioMap, addressMap);
    const inCrmCount = parcels.filter((p) => p.inCrm).length;

    return {
      queries: normalizedQueries,
      parcels,
      totalOnTaxRoll: parcels.length,
      inCrmCount,
      notInCrmCount: parcels.length - inCrmCount,
      truncated: parcels.length >= 3000,
    };
  } catch (e) {
    return {
      queries: normalizedQueries,
      parcels: [],
      totalOnTaxRoll: 0,
      inCrmCount: 0,
      notInCrmCount: 0,
      truncated: false,
      error: e instanceof Error ? e.message : "Tax roll search failed.",
    };
  }
}

/** Backward-compatible single-query discover. */
export async function discoverMdpaPortfolioSingle(
  query: string,
  mode?: MdpaSearchMode,
): Promise<MdpaPortfolioDiscovery> {
  const trimmed = query.trim();
  if (!trimmed) {
    return discoverMdpaPortfolio([]);
  }
  return discoverMdpaPortfolio([
    { query: trimmed, mode: mode ?? mdpaSearchModeForName(trimmed) },
  ]);
}

export async function importMdpaPortfolioParcel(
  strap: string,
  siteAddress: string,
  city?: string | null,
): Promise<{ id: string } | { error: string; existingId?: string }> {
  return importTaxRollFolio(strap, siteAddress, city);
}

export async function importAllMdpaPortfolioParcels(
  straps: { strap: string; address: string | null; city: string | null }[],
): Promise<{ imported: string[]; skipped: number; errors: string[] }> {
  const imported: string[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (const row of straps) {
    const address = row.address?.trim();
    if (!address) {
      skipped++;
      continue;
    }
    const res = await importTaxRollFolio(row.strap, address, row.city);
    if ("id" in res && res.id) {
      imported.push(res.id);
    } else if ("existingId" in res && res.existingId) {
      skipped++;
    } else if ("error" in res) {
      errors.push(`${row.strap}: ${res.error}`);
      if (errors.length >= 5) break;
    }
  }

  return { imported, skipped, errors };
}

// ─── Broward tax roll portfolio discovery ─────────────────────────────────────
// Parallel to the Miami-Dade functions above. Reuses the same MdpaSearchQuery
// shape (query/mode/label are county-agnostic owner-name searches) so callers
// can run one query list against both counties.

export async function discoverBcpaPortfolio(
  queries: { query: string; mode: MdpaSearchMode; label?: string }[],
): Promise<BcpaPortfolioDiscovery> {
  const normalizedQueries = queries
    .map((q) => ({ ...q, query: q.query.trim() }))
    .filter((q) => q.query.length >= 2);

  if (normalizedQueries.length === 0) {
    return {
      queries: [],
      parcels: [],
      totalOnTaxRoll: 0,
      inCrmCount: 0,
      notInCrmCount: 0,
      truncated: false,
      error: "No owner name to search.",
    };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return {
        queries: normalizedQueries,
        parcels: [],
        totalOnTaxRoll: 0,
        inCrmCount: 0,
        notInCrmCount: 0,
        truncated: false,
        error: "Not authenticated.",
      };
    }

    const hits = await searchBcpaParcelsByOwnerQueries(
      normalizedQueries.map((q) => ({ query: q.query, mode: q.mode })),
    );
    const { folioMap, addressMap } = await loadCrmMatchMaps(user.id, "bcpa:", bcpaFolioToStrap);
    const parcels = attachCrmStatus(hits, folioMap, addressMap);
    const inCrmCount = parcels.filter((p) => p.inCrm).length;

    return {
      queries: normalizedQueries,
      parcels,
      totalOnTaxRoll: parcels.length,
      inCrmCount,
      notInCrmCount: parcels.length - inCrmCount,
      truncated: parcels.length >= 3000,
    };
  } catch (e) {
    return {
      queries: normalizedQueries,
      parcels: [],
      totalOnTaxRoll: 0,
      inCrmCount: 0,
      notInCrmCount: 0,
      truncated: false,
      error: e instanceof Error ? e.message : "Broward tax roll search failed.",
    };
  }
}

export async function importBcpaPortfolioParcel(
  strap: string,
  siteAddress: string,
  city?: string | null,
): Promise<{ id: string } | { error: string; existingId?: string }> {
  return importBcpaFolio(strap, siteAddress, city);
}

export async function importAllBcpaPortfolioParcels(
  straps: { strap: string; address: string | null; city: string | null }[],
): Promise<{ imported: string[]; skipped: number; errors: string[] }> {
  const imported: string[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (const row of straps) {
    const address = row.address?.trim();
    if (!address) {
      skipped++;
      continue;
    }
    const res = await importBcpaFolio(row.strap, address, row.city);
    if ("id" in res && res.id) {
      imported.push(res.id);
    } else if ("existingId" in res && res.existingId) {
      skipped++;
    } else if ("error" in res) {
      errors.push(`${row.strap}: ${res.error}`);
      if (errors.length >= 5) break;
    }
  }

  return { imported, skipped, errors };
}

// ─── Palm Beach tax roll portfolio discovery ──────────────────────────────────
// Parallel to the Miami-Dade / Broward functions above. Reuses the same
// MdpaSearchQuery shape (query/mode/label are county-agnostic owner-name
// searches) so callers can run one query list against all three counties.

export async function discoverPbcpaPortfolio(
  queries: { query: string; mode: MdpaSearchMode; label?: string }[],
): Promise<PbcpaPortfolioDiscovery> {
  const normalizedQueries = queries
    .map((q) => ({ ...q, query: q.query.trim() }))
    .filter((q) => q.query.length >= 2);

  if (normalizedQueries.length === 0) {
    return {
      queries: [],
      parcels: [],
      totalOnTaxRoll: 0,
      inCrmCount: 0,
      notInCrmCount: 0,
      truncated: false,
      error: "No owner name to search.",
    };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return {
        queries: normalizedQueries,
        parcels: [],
        totalOnTaxRoll: 0,
        inCrmCount: 0,
        notInCrmCount: 0,
        truncated: false,
        error: "Not authenticated.",
      };
    }

    const hits = await searchPbcpaParcelsByOwnerQueries(
      normalizedQueries.map((q) => ({ query: q.query, mode: q.mode })),
    );
    const { folioMap, addressMap } = await loadCrmMatchMaps(user.id, "pbcpa:", pbcpaFolioToStrap);
    const parcels = attachCrmStatus(hits, folioMap, addressMap);
    const inCrmCount = parcels.filter((p) => p.inCrm).length;

    return {
      queries: normalizedQueries,
      parcels,
      totalOnTaxRoll: parcels.length,
      inCrmCount,
      notInCrmCount: parcels.length - inCrmCount,
      truncated: parcels.length >= 3000,
    };
  } catch (e) {
    return {
      queries: normalizedQueries,
      parcels: [],
      totalOnTaxRoll: 0,
      inCrmCount: 0,
      notInCrmCount: 0,
      truncated: false,
      error: e instanceof Error ? e.message : "Palm Beach tax roll search failed.",
    };
  }
}

export async function importPbcpaPortfolioParcel(
  strap: string,
  siteAddress: string,
  city?: string | null,
): Promise<{ id: string } | { error: string; existingId?: string }> {
  return importPbcpaFolio(strap, siteAddress, city);
}

export async function importAllPbcpaPortfolioParcels(
  straps: { strap: string; address: string | null; city: string | null }[],
): Promise<{ imported: string[]; skipped: number; errors: string[] }> {
  const imported: string[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (const row of straps) {
    const address = row.address?.trim();
    if (!address) {
      skipped++;
      continue;
    }
    const res = await importPbcpaFolio(row.strap, address, row.city);
    if ("id" in res && res.id) {
      imported.push(res.id);
    } else if ("existingId" in res && res.existingId) {
      skipped++;
    } else if ("error" in res) {
      errors.push(`${row.strap}: ${res.error}`);
      if (errors.length >= 5) break;
    }
  }

  return { imported, skipped, errors };
}
