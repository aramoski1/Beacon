"use server";

// Palm Beach tax roll → CRM import (portfolio discovery flow).
// Mirrors lib/bcpa-folio-ingest.ts / lib/mdpa-folio-ingest.ts, but PBRecord
// maps directly onto ExtractedProperty (no Claude extraction needed) — same
// no-Claude Palm Beach path used by the manual "Add property" flow in
// app/properties/new/actions.ts (pbcpaToFields there).

import { createClient } from "@/lib/supabase/server";
import {
  getPropertyDetail,
  extractOwnerMailing,
  primaryOwnerName,
  propertyUseToType,
  pbSaleDate,
  folioToStrap,
  type PBRecord,
} from "@/lib/pbcpa";
import { savePipelineProperty, type ExtractedProperty } from "@/lib/property-pipeline";
import { fetchFieldDefs } from "@/lib/custom-fields";
import { findDuplicate } from "@/lib/property-ingest";
import { mdpaIndividualOwnerContact } from "@/lib/owner-contacts";
import { logIngestionError } from "@/lib/ingestion-logger";

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// No building-square-footage field exists in Palm Beach's public table
// (unlike Broward's TOT_LVG_AREA) — size_sqft is left null rather than
// guessed. property_type comes from a free-text PROPERTY_USE description, not
// a numeric DOR code, via lib/pbcpa.ts's keyword classifier.
function pbcpaToFields(rec: PBRecord, customFields: Record<string, null> = {}): ExtractedProperty {
  const ownerName = primaryOwnerName(rec);
  const ownerNorm = (ownerName ?? "").replace(/\./g, "");
  const isEntity = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(ownerNorm);
  const acres = rec.ACRES;
  return {
    address: rec.SITE_ADDR_STR ?? null,
    city: rec.MUNICIPALITY ? titleCase(rec.MUNICIPALITY) : null,
    submarket: null,
    owner_name: ownerName,
    ownership_type: isEntity ? "institutional" : (ownerName ? "private" : "unknown"),
    size_sqft: null,
    property_type: propertyUseToType(rec.PROPERTY_USE),
    last_sale_date: pbSaleDate(rec.SALE_DATE),
    last_sale_price: rec.PRICE ?? null,
    building_composition: {
      lot_size_sqft: typeof acres === "number" && acres > 0 ? Math.round(acres * 43_560) : null,
      assessed_value: rec.ASSESSED_VAL ?? null,
      dor_code: null,
      dor_description: rec.PROPERTY_USE ? `Palm Beach PROPERTY_USE: ${rec.PROPERTY_USE}` : null,
    },
    confidence_flags: [],
    custom_fields: customFields,
  };
}

/** Import one Palm Beach tax roll folio into the broker's CRM (portfolio discovery flow). */
export async function importPbcpaFolio(
  strap: string,
  siteAddress: string,
  city?: string | null,
): Promise<{ id: string } | { error: string; existingId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const normalizedStrap = folioToStrap(strap);
  const sourceUrl = `pbcpa:${normalizedStrap}`;

  const existingId = await findDuplicate(supabase, user.id, sourceUrl, siteAddress);
  if (existingId) return { error: "Already in your workspace.", existingId };

  let rec: PBRecord | null;
  try {
    rec = await getPropertyDetail(normalizedStrap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "pbcpa_fetch",
      source_type: "address",
      source_ref: `${normalizedStrap} (${siteAddress})`,
      error_message: msg,
    });
    return { error: `PBCPA detail fetch failed: ${msg}` };
  }

  if (!rec) {
    return { error: `No Palm Beach parcel record found for folio ${normalizedStrap}.` };
  }

  const customExtractFields = (await fetchFieldDefs(supabase, "property")).filter(
    (f) => f.fill_mode === "extract",
  );
  const nullCustom = Object.fromEntries(customExtractFields.map((f) => [f.field_name, null]));
  const fields = pbcpaToFields(rec, nullCustom);

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
        city: city?.trim() || fields.city || "Palm Beach County",
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
