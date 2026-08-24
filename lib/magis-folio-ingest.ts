"use server";

// Massachusetts tax roll → CRM import (portfolio discovery flow).
// Mirrors lib/bcpa-folio-ingest.ts: MARecord maps directly onto
// ExtractedProperty (no Claude extraction needed) — same deterministic
// no-Claude path used by the manual "Add property" flow's magisToFields
// in app/properties/new/actions.ts.

import { createClient } from "@/lib/supabase/server";
import {
  getPropertyDetail,
  extractOwnerMailing,
  primaryOwnerName,
  propertyTypeFromUseDesc,
  maSaleDate,
  type MARecord,
} from "@/lib/magis";
import { savePipelineProperty, type ExtractedProperty } from "@/lib/property-pipeline";
import { fetchFieldDefs } from "@/lib/custom-fields";
import { findDuplicate } from "@/lib/property-ingest";
import { mdpaIndividualOwnerContact } from "@/lib/owner-contacts";
import { logIngestionError } from "@/lib/ingestion-logger";

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Same field mapping as magisToFields in app/properties/new/actions.ts —
// duplicated rather than shared, matching how bcpaToFields/pbcpaToFields are
// already duplicated between their own folio-ingest.ts and the manual "Add
// property" actions.ts in this codebase.
function magisToFields(rec: MARecord, customFields: Record<string, null> = {}): ExtractedProperty {
  const ownerName = primaryOwnerName(rec);
  const ownerNorm = (ownerName ?? "").replace(/\./g, "");
  const isEntity = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(ownerNorm);
  const sizeSqft = rec.BLD_AREA || rec.RES_AREA || null;
  const stories = rec.STORIES != null ? Number(rec.STORIES) : NaN;
  const lotSize = rec.LOT_SIZE;
  return {
    address: rec.SITE_ADDR ?? null,
    city: rec.CITY ? titleCase(rec.CITY) : null,
    submarket: null,
    owner_name: ownerName,
    ownership_type: isEntity ? "institutional" : (ownerName ? "private" : "unknown"),
    size_sqft: sizeSqft,
    property_type: propertyTypeFromUseDesc(rec.USE_DESC),
    last_sale_date: maSaleDate(rec.LS_DATE),
    last_sale_price: rec.LS_PRICE,
    building_composition: {
      year_built: rec.YEAR_BUILT ?? null,
      lot_size_sqft: typeof lotSize === "number" && lotSize > 0 && rec.LOT_UNITS === "Acres" ? Math.round(lotSize * 43_560) : null,
      stories: Number.isNaN(stories) ? null : stories,
      units: rec.UNITS ?? null,
      assessed_value: rec.TOTAL_VAL ?? null,
      dor_code: rec.USE_CODE ?? null,
      dor_description: rec.USE_DESC ?? null,
    },
    confidence_flags: [],
    custom_fields: customFields,
  };
}

/** Import one Massachusetts tax roll parcel into the broker's CRM (portfolio discovery flow). */
export async function importMagisFolio(
  locId: string,
  siteAddress: string,
  city?: string | null,
): Promise<{ id: string } | { error: string; existingId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const normalizedLocId = locId.trim();
  const sourceUrl = `magis:${normalizedLocId}`;

  const existingId = await findDuplicate(supabase, user.id, sourceUrl, siteAddress);
  if (existingId) return { error: "Already in your workspace.", existingId };

  let rec: MARecord | null;
  try {
    rec = await getPropertyDetail(normalizedLocId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "magis_fetch",
      source_type: "address",
      source_ref: `${normalizedLocId} (${siteAddress})`,
      error_message: msg,
    });
    return { error: `MassGIS detail fetch failed: ${msg}` };
  }

  if (!rec) {
    return { error: `No Massachusetts parcel record found for LOC_ID ${normalizedLocId}.` };
  }

  const customExtractFields = (await fetchFieldDefs(supabase, user.id, "property")).filter(
    (f) => f.fill_mode === "extract",
  );
  const nullCustom = Object.fromEntries(customExtractFields.map((f) => [f.field_name, null]));
  const fields = magisToFields(rec, nullCustom);

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
        city: city?.trim() || fields.city || "Massachusetts",
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
