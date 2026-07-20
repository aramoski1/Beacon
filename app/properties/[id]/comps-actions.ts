"use server";

import { unstable_cache } from "next/cache";
import {
  fetchTaxRollComps,
  folioFromMdpaSourceUrl,
  type TaxRollCompsResult,
} from "@/lib/mdpa-comps";

const cachedComps = unstable_cache(
  async (folio: string) => fetchTaxRollComps(folio),
  ["tax-roll-comps-v1"],
  { revalidate: 86400 },
);

export async function getTaxRollCompsForProperty(input: {
  sourceUrl: string | null;
  address?: string | null;
}): Promise<TaxRollCompsResult | { error: string }> {
  const folio = folioFromMdpaSourceUrl(input.sourceUrl);
  if (!folio) {
    return {
      error:
        "Tax-roll comps need a Miami-Dade folio (enrich from county first). Not available for non-MDPA properties.",
    };
  }

  try {
    return await cachedComps(folio);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to load tax-roll comps.",
    };
  }
}
