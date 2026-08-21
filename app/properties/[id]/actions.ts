"use server";

import { createClient } from "@/lib/supabase/server";
import { searchAndExtractSunbiz, type SunbizPerson, type SunbizResult } from "@/lib/sunbiz";
import {
  storedOwnerContactsFromSunbiz,
  mdpaIndividualOwnerContact,
  resolvePropertyOwnerContacts,
  type StoredOwnerContact,
} from "@/lib/owner-contacts";
import { logIngestionError } from "@/lib/ingestion-logger";
import { extractCoStarOwner, type CoStarOwner, type CoStarContact, type CoStarFileContent } from "@/lib/costar";
import { searchByAddressGIS, getPropertyDetail, extractOwnerMailing } from "@/lib/mdpa";
import { detectCounty, searchParcelsByAddress, type SupportedCounty } from "@/lib/county-router";
import { getPropertyDetail as bcpaDetail, extractOwnerMailing as bcpaExtractMailing, type BCPARecord } from "@/lib/bcpa";
import {
  getPropertyDetail as pbcpaDetail,
  extractOwnerMailing as pbcpaExtractMailing,
  primaryOwnerName as pbcpaOwnerName,
  pbSaleDate,
  type PBRecord,
} from "@/lib/pbcpa";
import { extractPropertyFields, type ExtractedProperty, type PipelineContent } from "@/lib/property-pipeline";
import { syncPropertyEntity, linkContactToEntity } from "@/lib/entities";
import { linkContactPropertyAndSync } from "@/lib/contact-properties";
import { ownersDiffer, saleDatesDiffer } from "@/lib/ownership-watch";
import { fetchFieldDefs, fieldSlug } from "@/lib/custom-fields";
import { fetchListingText } from "@/lib/listing-fetch";
import { computeDocumentDiff, type DocumentDiffEntry, type ExistingPropertyForDiff } from "@/lib/document-enhancement";

export async function createOwnerContact(
  propertyId: string
): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("owner_name, owner_mailing_address")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();

  if (propErr || !prop) return { error: "Property not found." };
  if (!prop.owner_name?.trim()) return { error: "Property has no owner name to use." };

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      owner_id: user.id,
      name: prop.owner_name.trim(),
      mailing_address: prop.owner_mailing_address ?? null,
      action_tags: ["mdpa_mailing", "unverified"],
      outreach_history: [],
      custom_fields: {},
      contact_type: "owner",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

// ─── Sunbiz lookup ────────────────────────────────────────────────────────────

export type SunbizLookupAction =
  | { error: string }
  | { result: SunbizResult | null; matches_found: number };

export async function lookupSunbiz(
  propertyId: string,
  searchTermOverride?: string
): Promise<SunbizLookupAction> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop } = await supabase
    .from("properties")
    .select("owner_name")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();

  if (!prop) return { error: "Property not found." };

  // Use the caller-provided override (e.g. corrected Sunbiz name) or fall back to DB owner_name
  const nameToSearch = searchTermOverride?.trim() || prop.owner_name?.trim();
  if (!nameToSearch) {
    return { error: "No entity name to search. Enter the name as it appears on Sunbiz." };
  }

  try {
    const lookup = await searchAndExtractSunbiz(nameToSearch);
    return lookup;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngestionError(supabase, user.id, {
      stage: "sunbiz_search",
      source_type: "address",
      source_ref: nameToSearch,
      error_message: msg,
    });
    return { error: `Sunbiz lookup failed: ${msg}` };
  }
}

// ─── Save Sunbiz authorized person onto the property row ─────────────────────

export type SunbizSaveAction =
  | { error: string }
  | { ok: true };

export async function saveSunbizOwnerContacts(
  propertyId: string,
  persons: SunbizPerson[],
): Promise<SunbizSaveAction> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!prop) return { error: "Property not found." };

  const owner_contacts = storedOwnerContactsFromSunbiz(persons);
  const { error } = await supabase
    .from("properties")
    .update({ owner_contacts })
    .eq("id", propertyId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  return { ok: true };
}

// ─── Promote one Sunbiz owner on the property row into a CRM contact ─────────

export async function createContactFromSunbizOwner(
  propertyId: string,
  personIndex: number,
): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("owner_contacts, owner_name, owner_mailing_address, entity_id")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();

  if (propErr || !prop) return { error: "Property not found." };

  const contacts = resolvePropertyOwnerContacts(prop.owner_contacts, prop.owner_name, prop.owner_mailing_address);
  const person = contacts[personIndex];
  if (!person?.name?.trim()) {
    return { error: "No Sunbiz owner at that index. Run a Sunbiz lookup first." };
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      owner_id: user.id,
      name: person.name.trim(),
      role: person.title || null,
      mailing_address: person.address ?? null,
      action_tags: ["sunbiz", "unverified"],
      outreach_history: [],
      custom_fields: {},
      contact_type: "owner",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Entity linking (ownership LLC) is independent of the property link and
  // stays automatic — only the property link itself is broker-confirmed.
  let entityId = prop.entity_id as string | null;
  if (!entityId && prop.owner_name?.trim()) {
    try {
      entityId = await syncPropertyEntity(supabase, user.id, propertyId, prop.owner_name);
    } catch {
      entityId = null;
    }
  }
  if (entityId) {
    try {
      await linkContactToEntity(supabase, user.id, entityId, data.id, person.title || null);
    } catch {
      // Contact exists; entity link is best-effort.
    }
  }

  return { id: data.id };
}

export type CoStarParseAction =
  | { error: string }
  | { owner: CoStarOwner };

export async function parseCoStarFile(
  formData: FormData
): Promise<CoStarParseAction> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Please select a file." };
  if (file.size > 10 * 1024 * 1024) return { error: "File must be under 10 MB." };

  const mime = file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  let content: CoStarFileContent;

  if (mime === "application/pdf" || ext === "pdf") {
    content = { type: "pdf", buffer: Buffer.from(await file.arrayBuffer()) };
  } else if (
    mime === "image/jpeg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    ["jpg", "jpeg", "png", "webp"].includes(ext)
  ) {
    const mimeType =
      mime === "image/jpeg" || ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : mime === "image/png" || ext === "png"
        ? "image/png"
        : "image/webp";
    content = {
      type: "image",
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType,
    };
  } else if (
    mime.startsWith("text/") ||
    mime === "application/csv" ||
    ["csv", "txt"].includes(ext)
  ) {
    content = { type: "text", text: await file.text() };
  } else {
    return {
      error: `Unsupported file type "${mime || ext || file.name}". Upload a PDF, image (JPG/PNG/WebP), or CSV/text file.`,
    };
  }

  try {
    const owner = await extractCoStarOwner(content);
    return { owner };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Extraction failed: ${msg}` };
  }
}

export type CoStarCreateAction =
  | { error: string }
  | { created: number; ids: string[] };

export async function createCoStarContacts(
  propertyId: string,
  contacts: CoStarContact[],
  companyName: string | null
): Promise<CoStarCreateAction> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Verify property ownership (defense-in-depth beyond RLS)
  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!prop) return { error: "Property not found." };

  const ids: string[] = [];
  for (const contact of contacts) {
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner_id: user.id,
        name: contact.name.trim(),
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        role: contact.title ?? null,
        company: companyName ?? null,
        linked_properties: [propertyId],
        action_tags: ["costar", "unverified"],
        outreach_history: [],
        custom_fields: {},
      })
      .select("id")
      .single();

    if (!error && data) {
      ids.push(data.id);
      try {
        await linkContactPropertyAndSync(supabase, user.id, data.id, propertyId);
      } catch {
        // Contact row exists with array shim.
      }
    }
  }

  return { created: ids.length, ids };
}

// ─── County enhancement ───────────────────────────────────────────────────────

export type MdpaEnhancementData = {
  owner_name: string | null;
  size_sqft: number | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  building_composition: Record<string, unknown> | null;
  owner_mailing_address: string | null;
  land_sqft: number | null;
  asset_description: string | null;
  // Broker-defined extract-mode custom fields pulled from the same county record,
  // e.g. clear height / dock doors when the source happens to carry them.
  custom_fields?: Record<string, string | number | null> | null;
  custom_field_flags?: { field: string; reason: string }[];
};

export type EnhancementDiffEntry = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type EnhancementPreview = {
  strap: string;
  siteAddress: string;
  county: SupportedCounty;
  changes: EnhancementDiffEntry[];
  unchanged: EnhancementDiffEntry[];
  mdpaData: MdpaEnhancementData;
  sunbiz_result: import("@/lib/sunbiz").SunbizResult | null;
  sunbiz_error: string | null;
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

// County detection from strap length: Broward folios are 12 digits,
// Miami-Dade 13, Palm Beach PCNs 17 (confirmed live — see lib/pbcpa.ts).
function countyFromStrap(strap: string): SupportedCounty {
  const digits = strap.replace(/-/g, "").length;
  if (digits === 12) return "broward";
  if (digits === 17) return "palm-beach";
  return "miami-dade";
}

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

// Step 1: GIS address search for an existing property
export async function initiateCountyEnhancement(
  propertyId: string
): Promise<{ matches: { strap: string; address: string }[] } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop } = await supabase
    .from("properties")
    .select("address, city, source, source_url")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!prop) return { error: "Property not found." };
  if (prop.source === "tax_roll") {
    return { error: "This property is already sourced from the county property appraiser." };
  }
  if (prop.source_url?.startsWith("mdpa:") || prop.source_url?.startsWith("bcpa:") || prop.source_url?.startsWith("pbcpa:")) {
    return { error: "This property has already been enhanced with county data." };
  }
  if (!prop.address?.trim()) {
    return { error: "This property has no address to search." };
  }

  // Use city to pick the known county first; fall back to searching both.
  const knownCounty = detectCounty(prop.city ?? "");

  try {
    const address = prop.address.trim();
    let parcels: { strap: string; address: string }[] = [];

    if (knownCounty) {
      const searchResult = await searchParcelsByAddress(address, knownCounty);
      if (searchResult.kind === "error") {
        return { error: `County property search failed: ${searchResult.message}` };
      }
      if (searchResult.kind === "too_many_candidates") {
        return {
          error: "Too many candidates for that address. Edit the property address to include the city (e.g. '2116 Sherman St, Hollywood') and try again.",
        };
      }
      parcels = searchResult.parcels;

      if (parcels.length === 0) {
        return {
          error: "No parcel found for this address. Verify the street number and name.",
        };
      }
    } else {
      // Unknown city — search all supported counties in parallel and merge results
      const [mdpaSettled, bcpaSettled, pbcpaSettled] = await Promise.allSettled([
        searchParcelsByAddress(address, "miami-dade"),
        searchParcelsByAddress(address, "broward"),
        searchParcelsByAddress(address, "palm-beach"),
      ]);
      const mdpaResult = mdpaSettled.status === "fulfilled" ? mdpaSettled.value : { kind: "error" as const, message: String(mdpaSettled.reason) };
      const bcpaResult = bcpaSettled.status === "fulfilled" ? bcpaSettled.value : { kind: "error" as const, message: String(bcpaSettled.reason) };
      const pbcpaResult = pbcpaSettled.status === "fulfilled" ? pbcpaSettled.value : { kind: "error" as const, message: String(pbcpaSettled.reason) };
      parcels = [
        ...(mdpaResult.kind === "ok" ? mdpaResult.parcels : []),
        ...(bcpaResult.kind === "ok" ? bcpaResult.parcels : []),
        ...(pbcpaResult.kind === "ok" ? pbcpaResult.parcels : []),
      ];

      if (parcels.length === 0) {
        // Couldn't route the city to a supported county, and every search
        // genuinely came back empty — most likely outside coverage (e.g.
        // Orlando/Orange County), not a property that doesn't exist.
        return {
          error: "This address appears to be outside our current coverage (Miami-Dade, Broward, and Palm Beach only).",
        };
      }
    }

    return { matches: parcels.map((p) => ({ strap: p.strap, address: p.address })) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `County property search failed: ${msg}` };
  }
}

// Step 2: Fetch county detail, extract fields, compute before/after diff
export async function previewCountyEnhancement(
  propertyId: string,
  strap: string,
  siteAddress: string
): Promise<{ preview: EnhancementPreview } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: existing } = await supabase
    .from("properties")
    .select(
      "owner_name, size_sqft, last_sale_date, last_sale_price, building_composition, owner_mailing_address, land_sqft, asset_description"
    )
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!existing) return { error: "Property not found." };

  const customExtractFields = (await fetchFieldDefs(supabase, user.id, "property")).filter(
    (f) => f.fill_mode === "extract"
  );

  const county = countyFromStrap(strap);

  function fmtN(n: number | null | undefined, opts?: Intl.NumberFormatOptions): string | null {
    if (n == null) return null;
    return n.toLocaleString("en-US", opts);
  }
  function fmtD(d: string | null | undefined): string | null {
    if (!d) return null;
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  const existingBc = existing.building_composition as Record<string, unknown> | null;
  const currency: Intl.NumberFormatOptions = { style: "currency", currency: "USD", maximumFractionDigits: 0 };

  let mdpaData: MdpaEnhancementData;
  let bc: Record<string, unknown> | null;

  // ── Broward: BCPARecord maps directly — no Claude needed ─────────────────────
  if (county === "broward") {
    let rec: BCPARecord | null;
    try {
      rec = await bcpaDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `BCPA detail fetch failed: ${msg}` };
    }
    if (!rec) return { error: `No Broward parcel record found for folio ${strap}.` };

    const dorCode = rec.DOR_UC ?? rec.PA_UC ?? null;
    bc = {
      year_built: rec.ACT_YR_BLT ?? rec.EFF_YR_BLT ?? null,
      lot_size_sqft: rec.LND_SQFOOT ?? null,
      assessed_value: rec.JV ?? null,
      dor_code: dorCode,
      dor_description: dorCode ? `DOR ${dorCode} — ${dorCodeToPropertyType(dorCode)}` : null,
    };
    mdpaData = {
      owner_name: rec.OWN_NAME ?? null,
      size_sqft: rec.TOT_LVG_AREA ?? null,
      last_sale_date: bcpaSaleDate(rec.SALE_YR1, rec.SALE_MO1),
      last_sale_price: rec.SALE_PRC1 ?? null,
      building_composition: bc,
      owner_mailing_address: bcpaExtractMailing(rec),
      land_sqft: rec.LND_SQFOOT != null ? Math.round(rec.LND_SQFOOT) : null,
      asset_description: dorCode ? `DOR ${dorCode} — ${dorCodeToPropertyType(dorCode)}` : null,
      // BCPA is a deterministic field mapping (no Claude call) — broker-defined
      // custom fields can't be extracted from it, so leave them null.
      custom_fields: Object.fromEntries(customExtractFields.map((f) => [fieldSlug(f.field_name), null])),
    };
  } else if (county === "palm-beach") {
    // ── Palm Beach: PBRecord maps directly — no Claude needed ──────────────────
    let rec: PBRecord | null;
    try {
      rec = await pbcpaDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `PBCPA detail fetch failed: ${msg}` };
    }
    if (!rec) return { error: `No Palm Beach parcel record found for folio ${strap}.` };

    // No building-square-footage field exists in Palm Beach's public table
    // (unlike Broward's TOT_LVG_AREA) — size_sqft stays null rather than guessed.
    const acres = rec.ACRES;
    const lotSizeSqft = typeof acres === "number" && acres > 0 ? Math.round(acres * 43_560) : null;
    const useDescription = rec.PROPERTY_USE ? `Palm Beach PROPERTY_USE: ${rec.PROPERTY_USE}` : null;
    bc = {
      lot_size_sqft: lotSizeSqft,
      assessed_value: rec.ASSESSED_VAL ?? null,
      dor_code: null,
      dor_description: useDescription,
    };
    mdpaData = {
      owner_name: pbcpaOwnerName(rec),
      size_sqft: null,
      last_sale_date: pbSaleDate(rec.SALE_DATE),
      last_sale_price: rec.PRICE ?? null,
      building_composition: bc,
      owner_mailing_address: pbcpaExtractMailing(rec),
      land_sqft: lotSizeSqft,
      asset_description: useDescription,
      // PBCPA is a deterministic field mapping (no Claude call) — broker-defined
      // custom fields can't be extracted from it, so leave them null.
      custom_fields: Object.fromEntries(customExtractFields.map((f) => [fieldSlug(f.field_name), null])),
    };
  } else {
    // ── Miami-Dade: raw JSON → Claude extraction ──────────────────────────────
    let detail: unknown;
    try {
      detail = await getPropertyDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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

    let fields: ExtractedProperty;
    try {
      fields = await extractPropertyFields(
        { type: "text", text: JSON.stringify(detail, null, 2), hint },
        MDPA_SYSTEM_PROMPT,
        customExtractFields
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `AI extraction failed: ${msg}` };
    }

    bc = fields.building_composition as Record<string, unknown> | null;
    mdpaData = {
      owner_name: fields.owner_name,
      size_sqft: fields.size_sqft,
      last_sale_date: fields.last_sale_date || null,
      last_sale_price: fields.last_sale_price ?? null,
      building_composition: bc,
      owner_mailing_address: extractOwnerMailing(detail),
      land_sqft: bc?.lot_size_sqft != null ? Math.round(bc.lot_size_sqft as number) : null,
      asset_description: (bc?.dor_description as string | null | undefined) ?? null,
      custom_fields: fields.custom_fields ?? null,
      custom_field_flags: (fields.confidence_flags ?? []).filter(
        (f) => f.field.startsWith("custom_fields.") || customExtractFields.some((d) => fieldSlug(d.field_name) === f.field)
      ).map((f) => ({
        field: f.field.startsWith("custom_fields.") ? f.field : `custom_fields.${f.field}`,
        reason: f.reason,
      })),
    };
  }

  const allFields: EnhancementDiffEntry[] = [
    { field: "owner_name",             label: "Owner name",             before: existing.owner_name ?? null,                                 after: mdpaData.owner_name },
    { field: "size_sqft",              label: "Building SF",            before: fmtN(existing.size_sqft),                                    after: fmtN(mdpaData.size_sqft) },
    { field: "last_sale_date",         label: "Last sale date",         before: fmtD(existing.last_sale_date),                               after: fmtD(mdpaData.last_sale_date) },
    { field: "last_sale_price",        label: "Last sale price",        before: fmtN(existing.last_sale_price, currency),                    after: fmtN(mdpaData.last_sale_price, currency) },
    { field: "owner_mailing_address",  label: "Owner mailing address",  before: existing.owner_mailing_address ?? null,                      after: mdpaData.owner_mailing_address },
    { field: "land_sqft",              label: "Land SF",                before: fmtN(existing.land_sqft),                                    after: fmtN(mdpaData.land_sqft) },
    { field: "asset_description",      label: "Asset description",      before: existing.asset_description ?? null,                          after: mdpaData.asset_description },
    { field: "building_composition.year_built",     label: "Year built",      before: existingBc?.year_built != null     ? String(existingBc.year_built)     : null, after: bc?.year_built != null     ? String(bc.year_built)     : null },
    { field: "building_composition.stories",        label: "Stories",         before: existingBc?.stories != null        ? String(existingBc.stories)        : null, after: bc?.stories != null        ? String(bc.stories)        : null },
    { field: "building_composition.units",          label: "Units",           before: existingBc?.units != null          ? String(existingBc.units)          : null, after: bc?.units != null          ? String(bc.units)          : null },
    { field: "building_composition.dor_code",       label: "DOR code",        before: (existingBc?.dor_code as string | null) ?? null,                             after: (bc?.dor_code as string | null) ?? null },
    { field: "building_composition.assessed_value", label: "Assessed value",  before: fmtN(existingBc?.assessed_value as number | null, currency),               after: fmtN(bc?.assessed_value as number | null, currency) },
  ];

  const changes   = allFields.filter((f) => f.before !== f.after);
  const unchanged = allFields.filter((f) => f.before === f.after && (f.before !== null || f.after !== null));

  // Auto Sunbiz — non-blocking, never prevents preview returning
  let sunbiz_result: import("@/lib/sunbiz").SunbizResult | null = null;
  let sunbiz_error: string | null = null;
  const ownerNorm = (mdpaData.owner_name ?? "").replace(/\./g, "");
  const isEntity = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(ownerNorm);
  if (isEntity && mdpaData.owner_name) {
    try {
      const lookup = await searchAndExtractSunbiz(mdpaData.owner_name);
      sunbiz_result = lookup.result;
      if (!sunbiz_result) sunbiz_error = "No matching entity found on Sunbiz.";
    } catch (e) {
      sunbiz_error = e instanceof Error ? e.message : String(e);
    }
  }

  return { preview: { strap, siteAddress, county, changes, unchanged, mdpaData, sunbiz_result, sunbiz_error } };
}

// ─── Ownership-change re-check ────────────────────────────────────────────────
// Fetches fresh MDPA data for a folio-linked property and flags it when
// owner_name or last_sale_date differ from what we have on record.

export type OwnershipChangeResult =
  | { ok: true; changed: false }
  | {
      ok: true; changed: true;
      previousOwner: string | null; newOwner: string | null;
      previousSaleDate: string | null; newSaleDate: string | null;
    }
  | { error: string };

export async function checkOwnershipChange(propertyId: string): Promise<OwnershipChangeResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop } = await supabase
    .from("properties")
    .select("owner_name, last_sale_date, source_url")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!prop) return { error: "Property not found." };

  const sourceUrl = prop.source_url as string | null;
  const strap = sourceUrl?.startsWith("mdpa:") ? sourceUrl.replace("mdpa:", "")
    : sourceUrl?.startsWith("bcpa:") ? sourceUrl.replace("bcpa:", "")
    : sourceUrl?.startsWith("pbcpa:") ? sourceUrl.replace("pbcpa:", "")
    : null;
  if (!strap) return { error: "No county folio on record. Run county enhancement first." };

  const county = countyFromStrap(strap);
  let newOwner: string | null;
  let newSaleDate: string | null;

  if (county === "broward") {
    let rec: BCPARecord | null;
    try {
      rec = await bcpaDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `BCPA fetch failed: ${msg}` };
    }
    if (!rec) return { error: "Broward parcel record not found." };
    newOwner = rec.OWN_NAME?.trim() ?? null;
    // BCPA only has year+month; compare year-month for change detection
    newSaleDate = rec.SALE_YR1 ? `${rec.SALE_YR1}-${String(rec.SALE_MO1 ?? "01").padStart(2, "0")}-01` : null;
  } else if (county === "palm-beach") {
    let rec: PBRecord | null;
    try {
      rec = await pbcpaDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `PBCPA fetch failed: ${msg}` };
    }
    if (!rec) return { error: "Palm Beach parcel record not found." };
    newOwner = pbcpaOwnerName(rec);
    // PBCPA has full day-level SALE_DATE — compare exactly (see saleDatesDiffer "full" call below)
    newSaleDate = pbSaleDate(rec.SALE_DATE);
  } else {
    let detail: unknown;
    try {
      detail = await getPropertyDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `MDPA fetch failed: ${msg}` };
    }
    const raw = detail as {
      OwnerInfos?: Array<{ Name?: string }>;
      SalesInfos?: Array<{ SaleDate?: string }>;
    };
    newOwner = raw.OwnerInfos?.[0]?.Name?.trim() ?? null;
    const latestSale = (raw.SalesInfos ?? [])
      .filter((s) => s.SaleDate)
      .sort((a, b) => new Date(b.SaleDate!).getTime() - new Date(a.SaleDate!).getTime())[0];
    newSaleDate = latestSale?.SaleDate?.slice(0, 10) ?? null;
  }

  const ownerChanged = ownersDiffer(prop.owner_name as string | null, newOwner);
  // For Broward, compare year-month only (no day in BCPA data)
  const storedDate = (prop.last_sale_date as string | null) ?? null;
  const saleChanged = saleDatesDiffer(
    storedDate,
    newSaleDate,
    county === "broward" ? "year_month" : "full",
  );

  const checkedAt = new Date().toISOString();

  if (!ownerChanged && !saleChanged) {
    await supabase
      .from("properties")
      .update({ ownership_last_checked_at: checkedAt })
      .eq("id", propertyId)
      .eq("owner_id", user.id);
    return { ok: true, changed: false };
  }

  await supabase
    .from("properties")
    .update({
      ownership_change_detected_at: checkedAt,
      ownership_last_checked_at: checkedAt,
      ownership_change_data: {
        previous_owner: prop.owner_name,
        new_owner: newOwner,
        previous_sale_date: (prop.last_sale_date as string | null) ?? null,
        new_sale_date: newSaleDate,
      },
    })
    .eq("id", propertyId)
    .eq("owner_id", user.id);

  return {
    ok: true, changed: true,
    previousOwner: prop.owner_name as string | null,
    newOwner,
    previousSaleDate: (prop.last_sale_date as string | null) ?? null,
    newSaleDate,
  };
}

export async function setOwnershipWatch(
  propertyId: string,
  enrolled: boolean,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("properties")
    .update({
      ownership_watch_enrolled_at: enrolled ? new Date().toISOString() : null,
    })
    .eq("id", propertyId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  return { ok: true };
}

/** Re-check up to `limit` enrolled properties (MDPA + BCPA via checkOwnershipChange). */
export async function runOwnershipWatchBatch(
  limit = 15,
): Promise<{ checked: number; changed: number; errors: string[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { checked: 0, changed: 0, errors: ["Not authenticated."] };

  const { data: rows } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", user.id)
    .not("ownership_watch_enrolled_at", "is", null)
    .order("ownership_last_checked_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 25));

  let checked = 0;
  let changed = 0;
  const errors: string[] = [];

  for (const row of rows ?? []) {
    const res = await checkOwnershipChange(row.id);
    checked += 1;
    if ("error" in res) {
      errors.push(`${row.id.slice(0, 8)}: ${res.error}`);
      continue;
    }
    if (res.changed) changed += 1;
  }

  return { checked, changed, errors };
}

// Step 3: Broker confirmed — merge county data and save selected Sunbiz owner fields
export async function applyCountyEnhancement(
  propertyId: string,
  strap: string,
  mdpaData: MdpaEnhancementData,
  sunbizPersons?: SunbizPerson[] | null,
): Promise<{ ok: true; owner_contacts_saved: number } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: existing } = await supabase
    .from("properties")
    .select("id, confidence_flags, custom_fields, field_sources")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!existing) return { error: "Property not found." };

  const MDPA_FIELDS = new Set([
    "owner_name", "size_sqft", "last_sale_date", "last_sale_price",
    "building_composition", "owner_mailing_address", "land_sqft", "asset_description",
    "building_composition.year_built", "building_composition.stories",
    "building_composition.units", "building_composition.assessed_value",
    "building_composition.dor_code", "building_composition.dor_description",
    "building_composition.lot_size_sqft", "building_composition.legal_description",
  ]);

  // Merge broker-defined custom fields: fill-only — a null (not found in this
  // county record) never clears a value a prior document/URL enhancement filled.
  const customFieldsUpdate: Record<string, string | number | null> = {
    ...((existing.custom_fields as Record<string, string | number | null> | null) ?? {}),
  };
  const touchedCustomFieldFlags = new Set<string>();
  const newCustomFlags: { field: string; reason: string }[] = [];
  for (const [slug, value] of Object.entries(mdpaData.custom_fields ?? {})) {
    const flagField = `custom_fields.${slug}`;
    touchedCustomFieldFlags.add(flagField);
    if (value != null) {
      customFieldsUpdate[slug] = value;
    } else {
      const matchedFlag = mdpaData.custom_field_flags?.find((f) => f.field === flagField);
      newCustomFlags.push({ field: flagField, reason: matchedFlag?.reason ?? "not found in source record" });
    }
  }

  const remainingFlags = (
    (existing.confidence_flags ?? []) as { field: string; reason: string }[]
  ).filter((f) => !MDPA_FIELDS.has(f.field) && !touchedCustomFieldFlags.has(f.field));

  const fieldSourcesUpdate: Record<string, string> = {
    ...((existing.field_sources as Record<string, string> | null) ?? {}),
  };
  for (const field of MDPA_FIELDS) fieldSourcesUpdate[field] = "county";
  for (const [slug, value] of Object.entries(mdpaData.custom_fields ?? {})) {
    if (value != null) fieldSourcesUpdate[`custom_fields.${slug}`] = "county";
  }

  const { error } = await supabase
    .from("properties")
    .update({
      owner_name:            mdpaData.owner_name,
      size_sqft:             mdpaData.size_sqft,
      last_sale_date:        mdpaData.last_sale_date,
      last_sale_price:       mdpaData.last_sale_price,
      building_composition:  mdpaData.building_composition,
      owner_mailing_address: mdpaData.owner_mailing_address,
      land_sqft:             mdpaData.land_sqft,
      asset_description:     mdpaData.asset_description,
      custom_fields:         customFieldsUpdate,
      field_sources:         fieldSourcesUpdate,
      source_url:            countyFromStrap(strap) === "broward" ? `bcpa:${strap}`
                              : countyFromStrap(strap) === "palm-beach" ? `pbcpa:${strap}`
                              : `mdpa:${strap}`,
      confidence_flags:      [...remainingFlags, ...newCustomFlags],
      ingested_at:           new Date().toISOString(),
    })
    .eq("id", propertyId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };

  try {
    await syncPropertyEntity(supabase, user.id, propertyId, mdpaData.owner_name);
  } catch {
    // Property update succeeded; entity sync is best-effort.
  }

  let owner_contacts_saved = 0;
  const owner_contacts = sunbizPersons?.length
    ? storedOwnerContactsFromSunbiz(sunbizPersons)
    : mdpaIndividualOwnerContact(mdpaData.owner_name, mdpaData.owner_mailing_address);
  if (owner_contacts.length > 0) {
    const { error: sunbizErr } = await supabase
      .from("properties")
      .update({ owner_contacts })
      .eq("id", propertyId)
      .eq("owner_id", user.id);
    if (sunbizErr) return { error: sunbizErr.message };
    owner_contacts_saved = owner_contacts.length;
  }

  return { ok: true, owner_contacts_saved };
}

// ─── Document / pasted-text / URL enhancement ─────────────────────────────────
// Same preview → broker-approves → apply shape as county enhancement above, but
// for a broker-supplied source (flyer, OM, pasted listing text, or a listing
// URL) instead of a county appraiser record. Reuses extractPropertyFields and
// the merge/conflict rules in lib/document-enhancement.ts.

export type DocumentEnhancementSourceKind = "document" | "url" | "pasted";

export type DocumentEnhancementPreview = {
  sourceKind: DocumentEnhancementSourceKind;
  sourceDetail: string | null; // filename or URL; null for pasted text
  changes: DocumentDiffEntry[];
  conflicts: DocumentDiffEntry[];
  unchanged: DocumentDiffEntry[];
  extracted: ExtractedProperty;
};

const EXISTING_FOR_DIFF_SELECT =
  "owner_name, size_sqft, land_sqft, asset_description, last_sale_date, last_sale_price, custom_fields";

async function buildDocumentContent(
  formData: FormData
): Promise<
  | { content: PipelineContent; sourceKind: DocumentEnhancementSourceKind; sourceDetail: string | null }
  | { error: string }
> {
  const file = formData.get("file") as File | null;
  const pastedText = (formData.get("text") as string | null)?.trim();
  const url = (formData.get("url") as string | null)?.trim();

  if (file && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) return { error: "File must be under 10 MB." };
    const mime = file.type;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

    if (mime === "application/pdf" || ext === "pdf") {
      return {
        content: { type: "pdf", buffer: Buffer.from(await file.arrayBuffer()) },
        sourceKind: "document",
        sourceDetail: file.name,
      };
    }
    if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || ["jpg", "jpeg", "png", "webp"].includes(ext)) {
      const mimeType =
        mime === "image/jpeg" || ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : mime === "image/png" || ext === "png"
          ? "image/png"
          : "image/webp";
      return {
        content: { type: "image", buffer: Buffer.from(await file.arrayBuffer()), mimeType },
        sourceKind: "document",
        sourceDetail: file.name,
      };
    }
    if (mime.startsWith("text/") || ["txt", "csv"].includes(ext)) {
      return {
        content: { type: "text", text: await file.text() },
        sourceKind: "document",
        sourceDetail: file.name,
      };
    }
    return { error: `Unsupported file type "${mime || ext || file.name}". Upload a PDF, image (JPG/PNG/WebP), or text file.` };
  }

  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      return { error: "Enter a valid http:// or https:// URL." };
    }
    let text: string;
    try {
      text = await fetchListingText(parsed.toString());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `Could not fetch the page: ${msg}` };
    }
    return {
      content: { type: "text", text, hint: `from listing URL: ${parsed.toString()}` },
      sourceKind: "url",
      sourceDetail: parsed.toString(),
    };
  }

  if (pastedText && pastedText.length >= 50) {
    return {
      content: { type: "text", text: pastedText.slice(0, 25_000), hint: "pasted document content" },
      sourceKind: "pasted",
      sourceDetail: null,
    };
  }

  return { error: "Upload a file, paste at least a few lines of text, or enter a URL." };
}

// Step 1+2 combined: build source content, extract, compute diff. No DB write.
export async function previewDocumentEnhancement(
  propertyId: string,
  formData: FormData
): Promise<{ preview: DocumentEnhancementPreview } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: existing } = await supabase
    .from("properties")
    .select(EXISTING_FOR_DIFF_SELECT)
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!existing) return { error: "Property not found." };

  const built = await buildDocumentContent(formData);
  if ("error" in built) return { error: built.error };
  const { content, sourceKind, sourceDetail } = built;

  const customExtractFields = (await fetchFieldDefs(supabase, user.id, "property")).filter(
    (f) => f.fill_mode === "extract"
  );

  let extracted: ExtractedProperty;
  try {
    extracted = await extractPropertyFields(content, undefined, customExtractFields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI extraction failed: ${msg}` };
  }

  const diff = computeDocumentDiff(
    existing as unknown as ExistingPropertyForDiff,
    extracted,
    customExtractFields
  );

  return {
    preview: {
      sourceKind,
      sourceDetail,
      changes: diff.changes,
      conflicts: diff.conflicts,
      unchanged: diff.unchanged,
      extracted,
    },
  };
}

// Step 3: broker approved — recompute the diff server-side (never trust client
// state for which fields are safe to bulk-apply) and write only the accepted set.
export async function applyDocumentEnhancement(
  propertyId: string,
  extracted: ExtractedProperty,
  acceptedConflictFields: string[],
  sourceKind: DocumentEnhancementSourceKind,
  _sourceDetail: string | null,
): Promise<{ ok: true; fieldsApplied: number } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: existing } = await supabase
    .from("properties")
    .select(`${EXISTING_FOR_DIFF_SELECT}, confidence_flags, field_sources`)
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!existing) return { error: "Property not found." };

  const customExtractFields = (await fetchFieldDefs(supabase, user.id, "property")).filter(
    (f) => f.fill_mode === "extract"
  );

  const diff = computeDocumentDiff(
    existing as unknown as ExistingPropertyForDiff,
    extracted,
    customExtractFields
  );

  const acceptedSet = new Set(acceptedConflictFields);
  const toApply = [...diff.changes, ...diff.conflicts.filter((c) => acceptedSet.has(c.field))];
  if (toApply.length === 0) return { error: "No fields selected to apply." };

  const update: Record<string, unknown> = {};
  const customFieldsUpdate: Record<string, string | number | null> = {
    ...((existing.custom_fields as Record<string, string | number | null> | null) ?? {}),
  };
  const fieldSourcesUpdate: Record<string, string> = {
    ...((existing.field_sources as Record<string, string> | null) ?? {}),
  };
  const touchedFieldNames = new Set(toApply.map((e) => e.field));
  const remainingFlags = (
    (existing.confidence_flags ?? []) as { field: string; reason: string }[]
  ).filter((f) => !touchedFieldNames.has(f.field));

  for (const entry of toApply) {
    if (entry.field.startsWith("custom_fields.")) {
      const slug = entry.field.replace("custom_fields.", "");
      customFieldsUpdate[slug] = entry.rawAfter;
    } else {
      update[entry.field] = entry.rawAfter;
    }
    fieldSourcesUpdate[entry.field] = sourceKind;
  }
  update.custom_fields = customFieldsUpdate;
  update.field_sources = fieldSourcesUpdate;
  update.confidence_flags = remainingFlags;

  const { error } = await supabase
    .from("properties")
    .update(update)
    .eq("id", propertyId)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };

  try {
    await syncPropertyEntity(supabase, user.id, propertyId, (update.owner_name as string | undefined) ?? existing.owner_name);
  } catch {
    // Property update succeeded; entity sync is best-effort.
  }

  return { ok: true, fieldsApplied: toApply.length };
}
