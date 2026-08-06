"use server";

import { unstable_cache } from "next/cache";
import {
  fetchTaxRollComps,
  folioFromMdpaSourceUrl,
  type TaxRollCompsResult,
} from "@/lib/mdpa-comps";
import { fetchBcpaTaxRollComps, folioFromBcpaSourceUrl } from "@/lib/bcpa-comps";
import { fetchPbcpaTaxRollComps, folioFromPbcpaSourceUrl } from "@/lib/pbcpa-comps";

const cachedMdpaComps = unstable_cache(
  async (folio: string) => fetchTaxRollComps(folio),
  ["tax-roll-comps-mdpa-v1"],
  { revalidate: 86400 },
);

const cachedBcpaComps = unstable_cache(
  async (folio: string) => fetchBcpaTaxRollComps(folio),
  ["tax-roll-comps-bcpa-v1"],
  { revalidate: 86400 },
);

const cachedPbcpaComps = unstable_cache(
  async (folio: string) => fetchPbcpaTaxRollComps(folio),
  ["tax-roll-comps-pbcpa-v1"],
  { revalidate: 86400 },
);

export async function getTaxRollCompsForProperty(input: {
  sourceUrl: string | null;
  address?: string | null;
}): Promise<TaxRollCompsResult | { error: string }> {
  const mdpaFolio = folioFromMdpaSourceUrl(input.sourceUrl);
  const bcpaFolio = folioFromBcpaSourceUrl(input.sourceUrl);
  const pbcpaFolio = folioFromPbcpaSourceUrl(input.sourceUrl);

  if (!mdpaFolio && !bcpaFolio && !pbcpaFolio) {
    return {
      error:
        "Tax-roll comps need a Miami-Dade, Broward, or Palm Beach folio (enrich from county first).",
    };
  }

  try {
    if (mdpaFolio) return await cachedMdpaComps(mdpaFolio);
    if (bcpaFolio) return await cachedBcpaComps(bcpaFolio);
    return await cachedPbcpaComps(pbcpaFolio!);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to load tax-roll comps.",
    };
  }
}
