"use server";

import { createClient } from "@/lib/supabase/server";
import {
  extractOwnerMailing,
  loadMdpaFolioSources,
  mdpaExtractHint,
  MDPA_SYSTEM_PROMPT,
  overlayMdpaOnExtracted,
} from "@/lib/mdpa";
import { extractPropertyFields, savePipelineProperty } from "@/lib/property-pipeline";
import { propertyExtractFieldDefs } from "@/lib/industrial-fields";
import { findDuplicate } from "@/lib/property-ingest";
import { mdpaIndividualOwnerContact } from "@/lib/owner-contacts";
import { logIngestionError } from "@/lib/ingestion-logger";
import { folioStrapKey } from "@/lib/mdpa-owner-search";
import { decodeSketchHtml } from "@/lib/mdpa-industrial";


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
  let sketchText: string | null = null;
  try {
    const loaded = await loadMdpaFolioSources(normalizedStrap);
    detail = loaded.detail;
    sketchText = loaded.sketchText;
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
    fields = overlayMdpaOnExtracted(
      await extractPropertyFields(
        {
          type: "text",
          text: [
            JSON.stringify(detail, null, 2),
            sketchText ? `\n\nBuilding sketch text:\n${decodeSketchHtml(sketchText).slice(0, 4_000)}` : "",
          ].join(""),
          hint: mdpaExtractHint(normalizedStrap, siteAddress),
        },
        MDPA_SYSTEM_PROMPT,
        customExtractFields,
      ),
      detail,
      sketchText,
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
