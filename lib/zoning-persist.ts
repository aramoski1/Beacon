// Shared "run zoning + save the result" step — called from every place a
// property gets its county data (re)populated (app/properties/new/actions.ts's
// saveIngestedProperty, and app/properties/[id]/actions.ts's
// applyCountyEnhancement / getPropertyZoning) so zoning is just part of that
// process rather than a separate manual step. Always best-effort: a zoning
// failure must never block or fail the county enrichment that triggered it.

import { getZoningInfo, type ZoningResult } from "./zoning";
import type { SupportedCounty } from "./county-router";
import type { createClient } from "./supabase/server";

export async function runAndPersistZoning(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  propertyId: string,
  input: { county: SupportedCounty; address: string; city: string | null; strap: string | null }
): Promise<ZoningResult> {
  const result = await getZoningInfo(input);

  if (result.kind === "ok") {
    await supabase
      .from("properties")
      .update({
        zoning_code: result.zone.code,
        zoning_far: result.zone.farEffective,
        zoning_source: result.source,
        zoning_checked_at: new Date().toISOString(),
        // Full zone detail (district name, use description, overlay, and MA's
        // height/dwelling-unit/density fields) so the property page can show
        // everything a live lookup shows, not just code+FAR, on a page load.
        zoning_data: result.zone,
        zoning_geocoded: result.geocoded,
      })
      .eq("id", propertyId)
      .eq("owner_id", ownerId);
  }

  return result;
}
