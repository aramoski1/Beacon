"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { searchParcelsByAddress, type SupportedCounty } from "@/lib/county-router";
import { getPropertyDetail as bcpaDetail, extractOwnerMailing as bcpaExtractMailing, type BCPARecord } from "@/lib/bcpa";
import { getPropertyDetail as mdpaDetail, extractOwnerMailing as mdpaExtractMailing } from "@/lib/mdpa";
import { extractPropertyFields, savePipelineProperty, type ExtractedProperty } from "@/lib/property-pipeline";
import { fetchFieldDefs } from "@/lib/custom-fields";
import { logIngestionError } from "@/lib/ingestion-logger";
import { searchAndExtractSunbiz, type SunbizResult, type SunbizPerson } from "@/lib/sunbiz";
import { storedOwnerContactsFromSunbiz, mdpaIndividualOwnerContact } from "@/lib/owner-contacts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FolioMatch = {
  strap: string;
  address: string;
  county: SupportedCounty;
};

export type PropertyPreview = ExtractedProperty & {
  address: string;
  city: string;
  strap: string;
  county: SupportedCounty;
  owner_mailing_address: string | null;
  sunbiz_result?: SunbizResult | null;
  sunbiz_error?: string | null;
};

export type IngestResult =
  | { error: string }
  | { matches: FolioMatch[] }
  | { preview: PropertyPreview };

// ─── BCPA field-mapping helpers ───────────────────────────────────────────────

function dorCodeToPropertyType(code: string | null): string {
  if (!code) return "other";
  const n = parseInt(code, 10);
  if (n === 1) return "residential";
  if ([3, 4, 8].includes(n)) return "multifamily";
  if (n >= 20 && n <= 28) return "retail";
  if (n >= 30 && n <= 39) return "office";
  if (n >= 40 && n <= 49) return "industrial";
  if (n >= 11 && n <= 18) return "land";
  return "other";
}

function bcpaSaleDate(yr: number | null, mo: string | null): string | null {
  if (!yr) return null;
  return `${yr}-${String(mo ?? "01").padStart(2, "0")}-01`;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function bcpaToFields(rec: BCPARecord, customFields: Record<string, null> = {}): ExtractedProperty {
  const dorCode = rec.DOR_UC ?? rec.PA_UC ?? null;
  const ownerNorm = (rec.OWN_NAME ?? "").replace(/\./g, "");
  const isEntity = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(ownerNorm);
  return {
    address: rec.PHY_ADDR1 ?? null,
    city: rec.PHY_CITY ? titleCase(rec.PHY_CITY) : null,
    submarket: null,
    owner_name: rec.OWN_NAME ?? null,
    ownership_type: isEntity ? "institutional" : (rec.OWN_NAME ? "private" : "unknown"),
    size_sqft: rec.TOT_LVG_AR ?? null,
    property_type: dorCodeToPropertyType(dorCode),
    last_sale_date: bcpaSaleDate(rec.SALE_YR1, rec.SALE_MO1),
    last_sale_price: rec.SALE_PRC1 ?? null,
    building_composition: {
      year_built: rec.ACT_YR_BLT ?? rec.EFF_YR_BLT ?? null,
      lot_size_sqft: rec.LND_SQFOOT ?? null,
      assessed_value: rec.JV ?? null,
      dor_code: dorCode ?? null,
    },
    confidence_flags: [],
    custom_fields: customFields,
  };
}

// ─── Step 1: Identify ─────────────────────────────────────────────────────────
// Always returns the full candidate list — the broker must confirm before we fetch anything.

export async function ingestAddress(formData: FormData): Promise<IngestResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const address = (formData.get("address") as string | null)?.trim();
  if (!address) return { error: "Please enter an address." };

  // Search both counties in parallel — an address can only be in one county,
  // so whichever finds results wins. City suffix hint is accepted but not required.
  const [mdpaResult, bcpaResult] = await Promise.allSettled([
    searchParcelsByAddress(address, "miami-dade"),
    searchParcelsByAddress(address, "broward"),
  ]);

  const mdpaParcels = mdpaResult.status === "fulfilled" ? mdpaResult.value : [];
  const bcpaParcels = bcpaResult.status === "fulfilled" ? bcpaResult.value : [];

  const matches = [
    ...mdpaParcels.map((p) => ({ strap: p.strap, address: p.address, county: "miami-dade" as const })),
    ...bcpaParcels.map((p) => ({ strap: p.strap, address: p.address, county: "broward" as const })),
  ];

  if (matches.length === 0) {
    // Surface a useful error: if both threw, show the first error; if searches ran but returned nothing, give a generic message
    const firstError = mdpaResult.status === "rejected" ? (mdpaResult.reason as Error).message
      : bcpaResult.status === "rejected" ? (bcpaResult.reason as Error).message
      : null;
    if (firstError) {
      await logIngestionError(supabase, user.id, {
        stage: "gis_fetch",
        source_type: "address",
        source_ref: address,
        error_message: firstError,
      });
      return { error: `Property search failed: ${firstError}` };
    }
    return {
      error: "No parcel found for that address. Double-check the street number and name. This feature supports Miami-Dade and Broward County properties.",
    };
  }

  return { matches };
}

// ─── Step 2: Extract ──────────────────────────────────────────────────────────
// Broker confirmed folio — fetch the full record and build a preview.

export async function ingestChosenFolio(formData: FormData): Promise<IngestResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const strap       = formData.get("strap")       as string;
  const siteAddress = formData.get("siteAddress") as string;
  const county      = (formData.get("county") as SupportedCounty | null) ?? "miami-dade";

  // ── Broward: BCPARecord maps directly — no Claude needed ─────────────────────
  if (county === "broward") {
    let rec: BCPARecord | null;
    try {
      rec = await bcpaDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logIngestionError(supabase, user.id, {
        stage: "bcpa_fetch",
        source_type: "address",
        source_ref: `${strap} (${siteAddress})`,
        error_message: msg,
      });
      return { error: `BCPA detail fetch failed: ${msg}` };
    }
    if (!rec) return { error: `No Broward parcel record found for folio ${strap}.` };

    const customExtractDefs = (await fetchFieldDefs(supabase, "property")).filter(f => f.fill_mode === "extract");
    const nullCustom = Object.fromEntries(customExtractDefs.map(f => [f.field_name, null]));
    const fields = bcpaToFields(rec, nullCustom);

    const ownerName = fields.owner_name?.trim() ?? "";
    const ownerNorm = ownerName.replace(/\./g, "");
    const isEntity = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(ownerNorm);

    let sunbiz_result: SunbizResult | null = null;
    let sunbiz_error: string | null = null;
    if (isEntity && ownerName) {
      try {
        const lookup = await searchAndExtractSunbiz(ownerName);
        sunbiz_result = lookup.result;
        if (!sunbiz_result) sunbiz_error = "No matching entity found on Sunbiz.";
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
        address: siteAddress,
        city: rec.PHY_CITY ? titleCase(rec.PHY_CITY) : "Broward County",
        strap,
        county: "broward",
        owner_mailing_address: bcpaExtractMailing(rec),
        sunbiz_result,
        sunbiz_error,
      },
    };
  }

  // ── Miami-Dade: raw JSON → Claude extraction ──────────────────────────────────
  let detail: unknown;
  try {
    detail = await mdpaDetail(strap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "mdpa_fetch",
      source_type: "address",
      source_ref: `${strap} (${siteAddress})`,
      error_message: msg,
    });
    return { error: `MDPA detail fetch failed: ${msg}` };
  }

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
      { type: "text", text: JSON.stringify(detail, null, 2), hint },
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

  let sunbiz_result: SunbizResult | null = null;
  let sunbiz_error: string | null = null;
  const ownerName = fields.owner_name?.trim() ?? "";
  const ownerNorm = ownerName.replace(/\./g, "");
  const isEntity = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(ownerNorm);
  if (isEntity && ownerName) {
    try {
      const lookup = await searchAndExtractSunbiz(ownerName);
      sunbiz_result = lookup.result;
      if (!sunbiz_result) sunbiz_error = "No matching entity found on Sunbiz.";
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
      address: siteAddress,
      city: "Miami",
      strap,
      county: "miami-dade",
      owner_mailing_address: mdpaExtractMailing(detail),
      sunbiz_result,
      sunbiz_error,
    },
  };
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveIngestedProperty(
  preview: PropertyPreview,
  selectedSunbizPersons?: SunbizPerson[]
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (!preview.address?.trim()) {
    return { error: "Cannot save a property without an address." };
  }

  const ownerContacts = selectedSunbizPersons?.length
    ? storedOwnerContactsFromSunbiz(selectedSunbizPersons)
    : mdpaIndividualOwnerContact(preview.owner_name, preview.owner_mailing_address);

  const sourceUrl = preview.county === "broward"
    ? `bcpa:${preview.strap}`
    : `mdpa:${preview.strap}`;

  let id: string;
  try {
    id = await savePipelineProperty(
      supabase,
      user.id,
      preview,
      "tax_roll",
      sourceUrl,
      {
        address: preview.address,
        city: preview.city,
        owner_mailing_address: preview.owner_mailing_address ?? null,
        owner_contacts: ownerContacts,
      }
    );
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

  return { id };
}
