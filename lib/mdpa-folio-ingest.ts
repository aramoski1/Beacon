"use server";

import { createClient } from "@/lib/supabase/server";
import { getPropertyDetail, extractOwnerMailing } from "@/lib/mdpa";
import { extractPropertyFields, savePipelineProperty } from "@/lib/property-pipeline";
import { propertyExtractFieldDefs } from "@/lib/industrial-fields";
import { findDuplicate } from "@/lib/property-ingest";
import { mdpaIndividualOwnerContact } from "@/lib/owner-contacts";
import { logIngestionError } from "@/lib/ingestion-logger";
import { folioStrapKey } from "@/lib/mdpa-owner-search";

const MDPA_SYSTEM_PROMPT = `You are a data-structuring assistant. You receive a JSON record from the Miami-Dade County Property Appraiser API and must populate a structured schema using ONLY data that is explicitly present in that record.

STRICT RULES — violation is not permitted:
1. Return a field value ONLY when it appears directly in the source JSON. Read it; do not compute or guess it.
2. Do NOT use your training knowledge about this address, neighborhood, city, market, or owner — even if you recognise the name or location. The source record is the only authorised data source.
3. For every field whose value is absent from the source JSON, return null AND add a confidence_flag: { "field": "<name>", "reason": "not found in source record" }.
4. Never output an empty confidence_flags array if any field is null.
5. Exceptions where limited inference is permitted because it reads from the source data:
   a. ownership_type: derive from the literal owner name string in the source — presence of LLC / CORP / INC / TRUST / FUND / REIT → "institutional"; government keywords (CITY, COUNTY, STATE, GOVT) → "institutional"; individual human-style names → "private".
   b. property_type: derive from the numeric DORCode in the source using Florida DOR mappings: 01 = "residential"; 03/04/08 = "multifamily"; 20–28 = "retail"; 30–39 = "office"; 40–49 = "industrial"; 11–18 = "land". If DORCode is absent, return null and flag.`;

function mdpaHint(strap: string, siteAddress: string): string {
  return `Miami-Dade Property Appraiser JSON for folio ${strap} (${siteAddress}).
Field locations in this record:
- owner_name: OwnerInfos[0].Name (primary owner; ignore Owner2/Owner3)
- size_sqft: PropertyInfo.BuildingActualArea (rentable/building area — NOT LotSize)
- last_sale_date / last_sale_price: most recent entry in SalesInfos[] by date
- building_composition.year_built: PropertyInfo.YearBuilt
- building_composition.lot_size_sqft: PropertyInfo.LotSize
- building_composition.stories: PropertyInfo.Stories (may appear as ActualStories)
- building_composition.units: PropertyInfo.Units (may appear as NoOfUnits)
- building_composition.dor_code: PropertyInfo.DORCode
- building_composition.assessed_value: PropertyInfo.AssessedValue
- building_composition.legal_description: PropertyInfo.LegalDescription
- submarket / geographic_category: not present in MDPA data — leave null`;
}

/** Import one tax roll folio into the broker's CRM (portfolio discovery flow). */
export async function importTaxRollFolio(
  strap: string,
  siteAddress: string,
  city?: string | null,
): Promise<{ id: string } | { error: string; existingId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const normalizedStrap = folioStrapKey(strap);
  const sourceUrl = `mdpa:${normalizedStrap}`;

  const existingId = await findDuplicate(supabase, user.id, sourceUrl, siteAddress);
  if (existingId) return { error: "Already in your workspace.", existingId };

  let detail: unknown;
  try {
    detail = await getPropertyDetail(normalizedStrap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "mdpa_fetch",
      source_type: "address",
      source_ref: `${normalizedStrap} (${siteAddress})`,
      error_message: msg,
    });
    return { error: `MDPA detail fetch failed: ${msg}` };
  }

  const customExtractFields = await propertyExtractFieldDefs(supabase, user.id);

  let fields;
  try {
    fields = await extractPropertyFields(
      {
        type: "text",
        text: JSON.stringify(detail, null, 2),
        hint: mdpaHint(normalizedStrap, siteAddress),
      },
      MDPA_SYSTEM_PROMPT,
      customExtractFields,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "ai_extract",
      source_type: "address",
      source_ref: `${normalizedStrap} (${siteAddress})`,
      error_message: msg,
    });
    return { error: msg };
  }

  const ownerMailing = extractOwnerMailing(detail);
  const ownerContacts = mdpaIndividualOwnerContact(fields.owner_name, ownerMailing);

  try {
    const id = await savePipelineProperty(
      supabase,
      user.id,
      fields,
      "tax_roll",
      sourceUrl,
      {
        address: siteAddress.trim() || fields.address,
        city: city?.trim() || fields.city || "Miami",
        owner_mailing_address: ownerMailing,
        owner_contacts: ownerContacts,
      },
    );
    return { id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "db_save",
      source_type: "address",
      source_ref: sourceUrl,
      error_message: msg,
    });
    return { error: msg };
  }
}
