"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { searchByAddressGIS, getPropertyDetail } from "@/lib/mdpa";
import { extractPropertyFields, savePipelineProperty, type ExtractedProperty } from "@/lib/property-pipeline";
import { fetchFieldDefs } from "@/lib/custom-fields";
import { logIngestionError } from "@/lib/ingestion-logger";
import { searchAndExtractSunbiz, type SunbizResult, type SunbizPerson } from "@/lib/sunbiz";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FolioMatch = {
  strap: string;
  address: string;
};

export type PropertyPreview = ExtractedProperty & {
  // MDPA-canonical values — override what Claude might extract from the JSON
  address: string;
  city: string;
  strap: string;
  // Owner mailing address read directly from OwnerInfos[0] — not AI-extracted
  owner_mailing_address: string | null;
  // Auto Sunbiz lookup result (entity owners only; null if not an entity or lookup failed)
  sunbiz_result?: SunbizResult | null;
  // Non-null when Sunbiz was attempted but failed — surfaces the reason in the UI
  sunbiz_error?: string | null;
};


export type IngestResult =
  | { error: string }
  | { matches: FolioMatch[] }
  | { preview: PropertyPreview };

// ─── Step 1: Identify — always returns candidate list, never auto-extracts ────

export async function ingestAddress(formData: FormData): Promise<IngestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const address = (formData.get("address") as string | null)?.trim();
  if (!address) return { error: "Please enter an address." };

  let parcels;
  try {
    parcels = await searchByAddressGIS(address);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "gis_fetch",
      source_type: "address",
      source_ref: address,
      error_message: msg,
    });
    return {
      error: `Miami-Dade property search failed: ${msg}`,
    };
  }

  if (parcels.length === 0) {
    return {
      error:
        "No Miami-Dade parcel found for that address. Double-check the street number and name. This feature only supports Miami-Dade County properties.",
    };
  }

  // Always return the full candidate list — never auto-select, even for one result.
  // The broker must confirm the folio before we fetch or extract anything.
  return {
    matches: parcels.map((p) => ({
      strap: p.strap,
      address: p.address,
    })),
  };
}

// ─── Step 2: Extract — broker confirmed folio, now fetch + structure the record ──

export async function ingestChosenFolio(formData: FormData): Promise<IngestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const strap         = formData.get("strap")         as string;
  const siteAddress   = formData.get("siteAddress")   as string;

  // Extract owner mailing address directly from raw MDPA JSON — no AI involved.
  // Fields: OwnerInfos[0].MailingAddress1/2, City, State, ZipCode
  function extractOwnerMailing(raw: unknown): string | null {
    const ownerInfo = (raw as { OwnerInfos?: Array<{
      MailingAddress1?: string;
      MailingAddress2?: string;
      City?: string;
      State?: string;
      ZipCode?: string;
    }> })?.OwnerInfos?.[0];
    if (!ownerInfo) return null;
    const parts: string[] = [];
    if (ownerInfo.MailingAddress1?.trim()) parts.push(ownerInfo.MailingAddress1.trim());
    if (ownerInfo.MailingAddress2?.trim()) parts.push(ownerInfo.MailingAddress2.trim());
    const cityState = ownerInfo.City?.trim() && ownerInfo.State?.trim()
      ? `${ownerInfo.City.trim()}, ${ownerInfo.State.trim()}${ownerInfo.ZipCode?.trim() ? " " + ownerInfo.ZipCode.trim() : ""}`
      : null;
    if (cityState) parts.push(cityState);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  let detail: unknown;
  try {
    detail = await getPropertyDetail(strap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "mdpa_fetch",
      source_type: "address",
      source_ref: `${strap} (${siteAddress})`,
      error_message: msg,
    });
    return {
      error: `MDPA detail fetch failed: ${msg}`,
    };
  }

  // Field-mapping notes tell Claude where each value lives in the MDPA JSON.
  // These are facts about the MDPA schema, not free-form hints — Claude reads
  // them as instructions for navigating the source record, not license to infer.
  const hint = `Miami-Dade Property Appraiser JSON for folio ${strap} (${siteAddress}).
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

  const MDPA_SYSTEM_PROMPT = `You are a data-structuring assistant. You receive a JSON record from the Miami-Dade County Property Appraiser API and must populate a structured schema using ONLY data that is explicitly present in that record.

STRICT RULES — violation is not permitted:
1. Return a field value ONLY when it appears directly in the source JSON. Read it; do not compute or guess it.
2. Do NOT use your training knowledge about this address, neighborhood, city, market, or owner — even if you recognise the name or location. The source record is the only authorised data source.
3. For every field whose value is absent from the source JSON, return null AND add a confidence_flag: { "field": "<name>", "reason": "not found in source record" }.
4. Never output an empty confidence_flags array if any field is null.
5. Exceptions where limited inference is permitted because it reads from the source data:
   a. ownership_type: derive from the literal owner name string in the source — presence of LLC / CORP / INC / TRUST / FUND / REIT → "institutional"; government keywords (CITY, COUNTY, STATE, GOVT) → "institutional"; individual human-style names → "private".
   b. property_type: derive from the numeric DORCode in the source using Florida DOR mappings: 01 = "residential"; 03/04/08 = "multifamily"; 20–28 = "retail"; 30–39 = "office"; 40–49 = "industrial"; 11–18 = "land". If DORCode is absent, return null and flag.`;

  const customExtractFields = (await fetchFieldDefs(supabase, "property")).filter(
    f => f.fill_mode === "extract"
  );

  let fields: ExtractedProperty;
  try {
    fields = await extractPropertyFields(
      {
        type: "text",
        text: JSON.stringify(detail, null, 2),
        hint,
      },
      MDPA_SYSTEM_PROMPT,
      customExtractFields
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "ai_extract",
      source_type: "address",
      source_ref: `${strap} (${siteAddress})`,
      error_message: msg,
    });
    return { error: msg };
  }

  // Auto Sunbiz: run for entity owners (LLC, INC, CORP, etc.) — non-blocking.
  // A failed Sunbiz lookup never prevents the property preview from returning.
  let sunbiz_result: SunbizResult | null = null;
  let sunbiz_error: string | null = null;
  const ownerName = fields.owner_name?.trim() ?? "";
  // Normalize before the entity check: MDPA sometimes stores "L.L.C." (with dots)
  // instead of "LLC", so strip periods first to match either form.
  const ownerNorm = ownerName.replace(/\./g, "");
  const isEntity = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(ownerNorm);
  if (isEntity && ownerName) {
    try {
      const lookup = await searchAndExtractSunbiz(ownerName);
      sunbiz_result = lookup.result;
      if (!sunbiz_result) {
        sunbiz_error = "No matching entity found on Sunbiz.";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sunbiz_error = `Sunbiz lookup failed: ${msg}`;
      await logIngestionError(supabase, user.id, {
        stage: "sunbiz_search",
        source_type: "address",
        source_ref: ownerName,
        error_message: `Auto Sunbiz: ${msg}`,
      });
    }
  }

  return {
    preview: {
      ...fields,
      // MDPA canonical values take precedence over whatever the model extracted
      address: siteAddress,
      city: "Miami",
      strap,
      owner_mailing_address: extractOwnerMailing(detail),
      sunbiz_result,
      sunbiz_error,
    },
  };
}

// ─── Broker confirmed — save to DB ────────────────────────────────────────────

export async function saveIngestedProperty(
  preview: PropertyPreview,
  sunbizPersonsToCreate?: SunbizPerson[]
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // MDPA path always has a canonical address from GIS; guard against corrupt calls
  if (!preview.address?.trim()) {
    return { error: "Cannot save a property without an address." };
  }

  let id: string;
  try {
    id = await savePipelineProperty(
      supabase,
      user.id,
      preview,
      "tax_roll",
      `mdpa:${preview.strap}`,
      {
        address: preview.address,
        city: preview.city,
        owner_mailing_address: preview.owner_mailing_address ?? null,
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "db_save",
      source_type: "address",
      source_ref: `mdpa:${preview.strap}`,
      error_message: msg,
    });
    return { error: msg };
  }

  // Create Sunbiz contacts linked to the new property — best-effort, non-fatal.
  if (sunbizPersonsToCreate?.length) {
    for (const person of sunbizPersonsToCreate) {
      try {
        await supabase.from("contacts").insert({
          owner_id: user.id,
          name: person.name,
          role: person.title || null,
          mailing_address: person.address ?? null,
          linked_properties: [id],
          action_tags: ["sunbiz", "unverified"],
          outreach_history: [],
          custom_fields: {},
        });
      } catch {
        // Individual contact failure is silently ignored; property is already saved.
      }
    }
  }

  return { id };
}
