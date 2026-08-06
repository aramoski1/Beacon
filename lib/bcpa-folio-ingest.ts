"use server";

// Broward tax roll → CRM import (portfolio discovery flow).
// Mirrors lib/mdpa-folio-ingest.ts, but BCPARecord maps directly onto
// ExtractedProperty (no Claude extraction needed) — same no-Claude Broward
// path used by the manual "Add property" flow in app/properties/new/actions.ts.

import { createClient } from "@/lib/supabase/server";
import { getPropertyDetail, extractOwnerMailing, folioToStrap, type BCPARecord } from "@/lib/bcpa";
import { savePipelineProperty, type ExtractedProperty } from "@/lib/property-pipeline";
import { fetchFieldDefs } from "@/lib/custom-fields";
import { findDuplicate } from "@/lib/property-ingest";
import { mdpaIndividualOwnerContact } from "@/lib/owner-contacts";
import { logIngestionError } from "@/lib/ingestion-logger";

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

function bcpaSaleDate(yr: number | null, mo: string | number | null): string | null {
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
    size_sqft: rec.TOT_LVG_AREA ?? null,
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

/** Import one Broward tax roll folio into the broker's CRM (portfolio discovery flow). */
export async function importBcpaFolio(
  strap: string,
  siteAddress: string,
  city?: string | null,
): Promise<{ id: string } | { error: string; existingId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const normalizedStrap = folioToStrap(strap);
  const sourceUrl = `bcpa:${normalizedStrap}`;

  const existingId = await findDuplicate(supabase, user.id, sourceUrl, siteAddress);
  if (existingId) return { error: "Already in your workspace.", existingId };

  let rec: BCPARecord | null;
  try {
    rec = await getPropertyDetail(normalizedStrap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "bcpa_fetch",
      source_type: "address",
      source_ref: `${normalizedStrap} (${siteAddress})`,
      error_message: msg,
    });
    return { error: `BCPA detail fetch failed: ${msg}` };
  }

  if (!rec) {
    return { error: `No Broward parcel record found for folio ${normalizedStrap}.` };
  }

  const customExtractFields = (await fetchFieldDefs(supabase, user.id, "property")).filter(
    (f) => f.fill_mode === "extract",
  );
  const nullCustom = Object.fromEntries(customExtractFields.map((f) => [f.field_name, null]));
  const fields = bcpaToFields(rec, nullCustom);

  const ownerMailing = extractOwnerMailing(rec);
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
        city: city?.trim() || fields.city || "Broward County",
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
