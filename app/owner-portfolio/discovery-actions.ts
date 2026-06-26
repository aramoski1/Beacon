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

async function loadCrmMatchMaps(userId: string): Promise<{
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
    if (row.source_url?.startsWith("mdpa:")) {
      folioMap.set(folioStrapKey(row.source_url.replace(/^mdpa:/, "")), row.id);
    }
    if (row.address?.trim()) {
      addressMap.set(normalizeAddress(row.address), row.id);
    }
  }

  return { folioMap, addressMap };
}

function attachCrmStatus(
  hits: MdpaOwnerParcelHit[],
  folioMap: Map<string, string>,
  addressMap: Map<string, string>,
): MdpaPortfolioParcel[] {
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
    const { folioMap, addressMap } = await loadCrmMatchMaps(user.id);
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
