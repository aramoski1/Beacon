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
import {
  searchByAddressGIS,
  getPropertyDetail,
  extractOwnerMailing,
  overlayMdpaOnExtracted,
  loadMdpaFolioSources,
  mdpaExtractHint,
  MDPA_SYSTEM_PROMPT,
} from "@/lib/mdpa";
import { decodeSketchHtml } from "@/lib/mdpa-industrial";
import { detectCounty, searchParcelsByAddress, type SupportedCounty } from "@/lib/county-router";
import { getPropertyDetail as bcpaDetail, extractOwnerMailing as bcpaExtractMailing, type BCPARecord } from "@/lib/bcpa";
import {
  getPropertyDetail as pbcpaDetail,
  extractOwnerMailing as pbcpaExtractMailing,
  primaryOwnerName as pbcpaOwnerName,
  pbSaleDate,
  type PBRecord,
} from "@/lib/pbcpa";
import {
  getPropertyDetail as magisDetail,
  extractOwnerMailing as magisExtractMailing,
  primaryOwnerName as magisOwnerName,
  propertyTypeFromUseDesc,
  maSaleDate,
  type MARecord,
} from "@/lib/magis";
import { jevLooksLikeEntityOwner, shouldLookupSunbizName } from "@/lib/jev-enrich";
import { jevAllowsDocumentExtract, jevClassifyDocument, jevRejectsJunkDocument } from "@/lib/jev-gates";
import { extractPropertyFields, type ExtractedProperty, type PipelineContent } from "@/lib/property-pipeline";
import { syncPropertyEntity, linkContactToEntity } from "@/lib/entities";
import { linkContactPropertyAndSync } from "@/lib/contact-properties";
import { ownersDiffer, saleDatesDiffer } from "@/lib/ownership-watch";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { fillCustomFieldsFromBuiltins } from "@/lib/custom-field-aliases";
import { INDUSTRIAL_SELECT, fetchIndustrialFieldDefs, industrialColumnForSlug, propertyExtractFieldDefs } from "@/lib/industrial-fields";
import { INDUSTRIAL_FIELD_KEYS, industrialFieldLabel, persistIndustrialFromExtract, yardAcresFromLandSqft } from "@/lib/industrial-extract";
import { fetchListingText } from "@/lib/listing-fetch";
import { computeDocumentDiff, type DocumentDiffEntry, type ExistingPropertyForDiff } from "@/lib/document-enhancement";
import {
  fieldSourceOf,
  isFieldLocked,
  tagManualIndustrial,
  type FieldSources,
} from "@/lib/field-lock";
import {
  discoverListingSpecs,
  planListingApplyWrites,
  type ListingDiscoverPreview,
} from "@/lib/listing-discover";
import { enqueueJob } from "@/lib/jobs";
import type { ZoningResult } from "@/lib/zoning";
import { runAndPersistZoning } from "@/lib/zoning-persist";
export type { ZoningResult } from "@/lib/zoning";
export type { ListingDiscoverPreview } from "@/lib/listing-discover";

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
    .select("owner_name, source_url")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();

  if (!prop) return { error: "Property not found." };

  // Sunbiz is Florida's Division of Corporations registry — it has no
  // knowledge of Massachusetts entities. Querying it for a MA-sourced
  // property risks a false-positive match against an unrelated Florida
  // entity that happens to share a name, which would silently attribute the
  // wrong registered agent/officers to this property. Server-side gate
  // (not just a UI hint) because this action has multiple callers
  // (enrich-panel.tsx, the CRM bulk-enrich panel) that must all be
  // protected the same way, not just whichever one remembers to check.
  if (prop.source_url?.startsWith("magis:")) {
    return { error: "Entity/owner lookup isn't available for Massachusetts yet — Sunbiz only covers Florida-registered entities." };
  }

  // Use the caller-provided override (e.g. corrected Sunbiz name) or fall back to DB owner_name
  const nameToSearch = searchTermOverride?.trim() || prop.owner_name?.trim();
  if (!nameToSearch) {
    return { error: "No entity name to search. Enter the name as it appears on Sunbiz." };
  }

  if (
    !searchTermOverride &&
    !shouldLookupSunbizName(nameToSearch, await jevLooksLikeEntityOwner(nameToSearch))
  ) {
    return { error: "Owner name does not look like a Florida entity. Enter the Sunbiz name to search anyway." };
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
  companyName: string | null,
  defaultType: "owner" | "tenant" = "owner",
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
        contact_type: contact.contact_type === "tenant" ? "tenant" : defaultType,
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
  clear_height_ft?: number | null;
  dock_doors?: number | null;
  drive_in_doors?: number | null;
  power_amps?: number | null;
  power_phase?: string | null;
  yard_acres?: number | null;
  column_spacing?: string | null;
  sprinkler_type?: string | null;
  availability_status?: string | null;
  asking_rent_psf?: number | null;
  nnn_cam_psf?: number | null;
  lease_structure?: string | null;
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

// County detection from strap format: Massachusetts LOC_IDs are always
// "F_<digits>_<digits>" (confirmed live — see lib/magis.ts), checked first
// since it's structurally distinct from any Florida folio; Broward folios
// are 12 digits, Miami-Dade 13, Palm Beach PCNs 17 (confirmed live — see
// lib/pbcpa.ts).
function countyFromStrap(strap: string): SupportedCounty {
  if (strap.startsWith("F_")) return "massachusetts";
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
  if (
    prop.source_url?.startsWith("mdpa:") ||
    prop.source_url?.startsWith("bcpa:") ||
    prop.source_url?.startsWith("pbcpa:") ||
    prop.source_url?.startsWith("magis:")
  ) {
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
      // Unknown city — search all supported regions in parallel and merge results
      const [mdpaSettled, bcpaSettled, pbcpaSettled, magisSettled] = await Promise.allSettled([
        searchParcelsByAddress(address, "miami-dade"),
        searchParcelsByAddress(address, "broward"),
        searchParcelsByAddress(address, "palm-beach"),
        searchParcelsByAddress(address, "massachusetts"),
      ]);
      const mdpaResult = mdpaSettled.status === "fulfilled" ? mdpaSettled.value : { kind: "error" as const, message: String(mdpaSettled.reason) };
      const bcpaResult = bcpaSettled.status === "fulfilled" ? bcpaSettled.value : { kind: "error" as const, message: String(bcpaSettled.reason) };
      const pbcpaResult = pbcpaSettled.status === "fulfilled" ? pbcpaSettled.value : { kind: "error" as const, message: String(pbcpaSettled.reason) };
      const magisResult = magisSettled.status === "fulfilled" ? magisSettled.value : { kind: "error" as const, message: String(magisSettled.reason) };
      parcels = [
        ...(mdpaResult.kind === "ok" ? mdpaResult.parcels : []),
        ...(bcpaResult.kind === "ok" ? bcpaResult.parcels : []),
        ...(pbcpaResult.kind === "ok" ? pbcpaResult.parcels : []),
        ...(magisResult.kind === "ok" ? magisResult.parcels : []),
      ];

      if (parcels.length === 0) {
        // Couldn't route the city to a supported region, and every search
        // genuinely came back empty — most likely outside coverage (e.g.
        // Orlando/Orange County), not a property that doesn't exist.
        return {
          error: "This address appears to be outside our current coverage (Miami-Dade, Broward, and Palm Beach counties; Boston-metro Massachusetts).",
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
      `owner_name, size_sqft, last_sale_date, last_sale_price, building_composition, owner_mailing_address, land_sqft, asset_description, ${INDUSTRIAL_SELECT}`
    )
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!existing) return { error: "Property not found." };

  const customExtractFields = await propertyExtractFieldDefs(supabase, user.id);
  const { data: propertyFieldDefs } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", "property");

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
  } else if (county === "massachusetts") {
    // ── Massachusetts: MARecord maps directly — no Claude needed ───────────────
    let rec: MARecord | null;
    try {
      rec = await magisDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `MassGIS detail fetch failed: ${msg}` };
    }
    if (!rec) return { error: `No Massachusetts parcel record found for LOC_ID ${strap}.` };

    const sizeSqft = rec.BLD_AREA || rec.RES_AREA || null;
    const stories = rec.STORIES != null ? Number(rec.STORIES) : NaN;
    const lotSize = rec.LOT_SIZE;
    const lotSizeSqft = typeof lotSize === "number" && lotSize > 0 && rec.LOT_UNITS === "Acres" ? Math.round(lotSize * 43_560) : null;
    bc = {
      year_built: rec.YEAR_BUILT ?? null,
      lot_size_sqft: lotSizeSqft,
      stories: Number.isNaN(stories) ? null : stories,
      units: rec.UNITS ?? null,
      assessed_value: rec.TOTAL_VAL ?? null,
      dor_code: rec.USE_CODE ?? null,
      dor_description: rec.USE_DESC ?? null,
    };
    mdpaData = {
      owner_name: magisOwnerName(rec),
      size_sqft: sizeSqft && sizeSqft > 0 ? sizeSqft : null,
      last_sale_date: maSaleDate(rec.LS_DATE),
      last_sale_price: rec.LS_PRICE,
      building_composition: bc,
      owner_mailing_address: magisExtractMailing(rec),
      land_sqft: lotSizeSqft,
      asset_description: rec.USE_DESC ? `MassGIS USE_DESC: ${rec.USE_DESC} (${propertyTypeFromUseDesc(rec.USE_DESC)})` : null,
      // MassGIS is a deterministic field mapping (no Claude call) — broker-
      // defined custom fields can't be extracted from it, so leave them
      // null. No auto-Sunbiz below either — Sunbiz is Florida-only (see
      // lib/magis.ts file header, lookupSunbiz's guard above).
      custom_fields: Object.fromEntries(customExtractFields.map((f) => [fieldSlug(f.field_name), null])),
    };
  } else {
    // ── Miami-Dade: raw JSON → Claude extraction ──────────────────────────────
    let detail: unknown;
    let sketchText: string | null = null;
    try {
      const loaded = await loadMdpaFolioSources(strap);
      detail = loaded.detail;
      sketchText = loaded.sketchText;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `MDPA detail fetch failed: ${msg}` };
    }

    const sketchPlain = sketchText ? decodeSketchHtml(sketchText).slice(0, 4_000) : "";
    let fields: ExtractedProperty;
    try {
      fields = overlayMdpaOnExtracted(
        await extractPropertyFields(
          {
            type: "text",
            text: [JSON.stringify(detail, null, 2), sketchPlain ? `\n\nBuilding sketch text:\n${sketchPlain}` : ""].join(""),
            hint: mdpaExtractHint(strap, siteAddress),
          },
          MDPA_SYSTEM_PROMPT,
          customExtractFields
        ),
        detail,
        sketchText,
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
      clear_height_ft: fields.clear_height_ft ?? null,
      dock_doors: fields.dock_doors ?? null,
      drive_in_doors: fields.drive_in_doors ?? null,
      power_amps: fields.power_amps ?? null,
      power_phase: fields.power_phase ?? null,
      yard_acres: fields.yard_acres ?? null,
      column_spacing: fields.column_spacing ?? null,
      sprinkler_type: fields.sprinkler_type ?? null,
      availability_status: fields.availability_status ?? null,
      asking_rent_psf: fields.asking_rent_psf ?? null,
      nnn_cam_psf: fields.nnn_cam_psf ?? null,
      lease_structure: fields.lease_structure ?? null,
      custom_field_flags: (fields.confidence_flags ?? []).filter(
        (f) => f.field.startsWith("custom_fields.") || customExtractFields.some((d) => fieldSlug(d.field_name) === f.field)
      ).map((f) => ({
        field: f.field.startsWith("custom_fields.") ? f.field : `custom_fields.${f.field}`,
        reason: f.reason,
      })),
    };
  }

  mdpaData.custom_fields = fillCustomFieldsFromBuiltins(
    (propertyFieldDefs ?? customExtractFields) as FieldDefinition[],
    mdpaData.custom_fields ?? {},
    {
      size_sqft: mdpaData.size_sqft,
      land_sqft: mdpaData.land_sqft,
      building_composition: mdpaData.building_composition as {
        year_built?: number | null;
        lot_size_sqft?: number | null;
        stories?: number | null;
        units?: number | null;
        assessed_value?: number | null;
      } | null,
    },
  );

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
    ...INDUSTRIAL_FIELD_KEYS.map((key) => {
      const before = (existing as Record<string, unknown>)[key];
      const after = mdpaData[key];
      return {
        field: key,
        label: industrialFieldLabel(key),
        before: before != null && before !== "" ? String(before) : null,
        after: after != null && after !== "" ? String(after) : null,
      };
    }),
  ];

  const changes   = allFields.filter((f) => f.before !== f.after);
  const unchanged = allFields.filter((f) => f.before === f.after && (f.before !== null || f.after !== null));

  // Auto Sunbiz — non-blocking, never prevents preview returning.
  // Sunbiz is Florida's Division of Corporations registry — never run it for
  // a Massachusetts property regardless of whether the owner name happens to
  // match the LLC/INC/CORP pattern (a MA LLC matches that pattern too), or a
  // same-named unrelated Florida entity could get silently attributed here.
  let sunbiz_result: import("@/lib/sunbiz").SunbizResult | null = null;
  let sunbiz_error: string | null = null;
  const ownerNorm = (mdpaData.owner_name ?? "").replace(/\./g, "");
  const isEntity = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i.test(ownerNorm);
  if (county !== "massachusetts" && isEntity && mdpaData.owner_name) {
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
    : sourceUrl?.startsWith("magis:") ? sourceUrl.replace("magis:", "")
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
  } else if (county === "massachusetts") {
    let rec: MARecord | null;
    try {
      rec = await magisDetail(strap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `MassGIS fetch failed: ${msg}` };
    }
    if (!rec) return { error: "Massachusetts parcel record not found." };
    newOwner = magisOwnerName(rec);
    // LS_DATE is full day-level (YYYYMMDD) — compare exactly, same as MDPA/PBCPA below.
    newSaleDate = maSaleDate(rec.LS_DATE);
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

/** Re-check up to `limit` enrolled properties (MDPA/BCPA/PBCPA/MassGIS via checkOwnershipChange). */
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
): Promise<{ ok: true; owner_contacts_saved: number; zoning: ZoningResult } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: existing } = await supabase
    .from("properties")
    .select(`id, address, city, confidence_flags, custom_fields, field_sources, land_sqft, ${INDUSTRIAL_SELECT}`)
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
  const fieldSourcesUpdate: Record<string, string> = {
    ...((existing.field_sources as Record<string, string> | null) ?? {}),
  };

  const { data: propertyFieldDefs } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", "property");
  const countyCustom = fillCustomFieldsFromBuiltins(
    (propertyFieldDefs ?? []) as FieldDefinition[],
    mdpaData.custom_fields ?? {},
    {
      size_sqft: mdpaData.size_sqft,
      land_sqft: mdpaData.land_sqft,
      building_composition: mdpaData.building_composition as {
        year_built?: number | null;
        lot_size_sqft?: number | null;
        stories?: number | null;
        units?: number | null;
        assessed_value?: number | null;
      } | null,
      clear_height_ft: mdpaData.clear_height_ft,
      dock_doors: mdpaData.dock_doors,
      drive_in_doors: mdpaData.drive_in_doors,
      power_amps: mdpaData.power_amps,
      power_phase: mdpaData.power_phase,
      yard_acres: mdpaData.yard_acres,
      column_spacing: mdpaData.column_spacing,
      sprinkler_type: mdpaData.sprinkler_type,
      availability_status: mdpaData.availability_status,
      asking_rent_psf: mdpaData.asking_rent_psf,
      nnn_cam_psf: mdpaData.nnn_cam_psf,
      lease_structure: mdpaData.lease_structure,
    },
  );

  for (const [slug, value] of Object.entries(countyCustom)) {
    const flagField = `custom_fields.${slug}`;
    touchedCustomFieldFlags.add(flagField);
    if (value != null) {
      if (isFieldLocked(fieldSourcesUpdate, flagField) && fieldSourceOf(fieldSourcesUpdate, flagField) !== "county") {
        continue;
      }
      customFieldsUpdate[slug] = value;
      fieldSourcesUpdate[flagField] = "county";
    } else {
      const matchedFlag = mdpaData.custom_field_flags?.find((f) => f.field === flagField);
      newCustomFlags.push({ field: flagField, reason: matchedFlag?.reason ?? "not found in source record" });
    }
  }

  const remainingFlags = (
    (existing.confidence_flags ?? []) as { field: string; reason: string }[]
  ).filter((f) => !MDPA_FIELDS.has(f.field) && !touchedCustomFieldFlags.has(f.field));

  for (const field of MDPA_FIELDS) fieldSourcesUpdate[field] = "county";

  const landSqft = mdpaData.land_sqft ?? existing.land_sqft ?? null;
  const industrialDefs = await fetchIndustrialFieldDefs(supabase);
  const persist = persistIndustrialFromExtract(industrialDefs, {
    custom_fields: customFieldsUpdate,
    clear_height_ft: mdpaData.clear_height_ft,
    dock_doors: mdpaData.dock_doors,
    drive_in_doors: mdpaData.drive_in_doors,
    power_amps: mdpaData.power_amps,
    power_phase: mdpaData.power_phase,
    yard_acres: mdpaData.yard_acres,
    column_spacing: mdpaData.column_spacing,
    sprinkler_type: mdpaData.sprinkler_type,
    availability_status: mdpaData.availability_status,
    asking_rent_psf: mdpaData.asking_rent_psf,
    nnn_cam_psf: mdpaData.nnn_cam_psf,
    lease_structure: mdpaData.lease_structure,
  });
  for (const [slug, value] of Object.entries(persist.custom)) {
    const flagField = `custom_fields.${slug}`;
    if (isFieldLocked(fieldSourcesUpdate, flagField) && fieldSourceOf(fieldSourcesUpdate, flagField) !== "county") {
      continue;
    }
    customFieldsUpdate[slug] = value;
  }
  const industrialUpdate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(persist.columns)) {
    if (isFieldLocked(fieldSourcesUpdate, key) && fieldSourceOf(fieldSourcesUpdate, key) !== "county") {
      continue;
    }
    const current = (existing as Record<string, unknown>)[key];
    if ((current == null || current === "") && value != null) {
      industrialUpdate[key] = value;
      fieldSourcesUpdate[key] = "county";
    }
  }
  const yardStillConfigured = industrialDefs.some(
    (d) => industrialColumnForSlug(fieldSlug(d.field_name)) === "yard_acres",
  );
  if (
    yardStillConfigured &&
    industrialUpdate.yard_acres == null &&
    (existing.yard_acres == null || existing.yard_acres === "") &&
    landSqft
  ) {
    const derived = yardAcresFromLandSqft(Number(landSqft));
    if (derived != null) {
      industrialUpdate.yard_acres = derived;
      fieldSourcesUpdate.yard_acres = "county";
      const yardSlug = industrialDefs
        .map((d) => fieldSlug(d.field_name))
        .find((s) => industrialColumnForSlug(s) === "yard_acres");
      if (yardSlug && (customFieldsUpdate[yardSlug] == null || customFieldsUpdate[yardSlug] === "")) {
        customFieldsUpdate[yardSlug] = derived;
      }
    }
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
                              : countyFromStrap(strap) === "massachusetts" ? `magis:${strap}`
                              : `mdpa:${strap}`,
      confidence_flags:      [...remainingFlags, ...newCustomFlags],
      ingested_at:           new Date().toISOString(),
      ...industrialUpdate,
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

  // Zoning is just part of county enrichment now — run it automatically
  // instead of requiring a separate manual step. Best-effort: county
  // enrichment has already succeeded above, so a zoning failure (or an
  // honest "unavailable" for an incorporated FL city) shouldn't fail this call.
  let zoning: ZoningResult;
  try {
    zoning = await runAndPersistZoning(supabase, user.id, propertyId, {
      county: countyFromStrap(strap),
      address: existing.address ?? "",
      city: existing.city,
      strap,
    });
  } catch (e) {
    zoning = { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }

  // Same automatic listing pass as tax-roll / new-property save. Best-effort:
  // county apply already succeeded if this queue insert fails.
  if (existing.address?.trim()) {
    await enqueueJob(supabase as never, user.id, "listing_discover", { propertyId });
  }

  return { ok: true, owner_contacts_saved, zoning };
}

export async function saveIndustrialSpec(
  propertyId: string,
  slug: string,
  value: string | number | null,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (!slug) return { error: "Missing field." };

  const { data: existing } = await supabase
    .from("properties")
    .select("custom_fields, field_sources")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!existing) return { error: "Property not found." };

  const custom = {
    ...((existing.custom_fields as Record<string, string | number | null> | null) ?? {}),
    [slug]: value,
  };
  const patch: Record<string, unknown> = {
    custom_fields: custom,
    field_sources: tagManualIndustrial(existing.field_sources as FieldSources | null, slug),
    updated_at: new Date().toISOString(),
  };
  const column = industrialColumnForSlug(slug);
  if (column) patch[column] = value;

  const { error } = await supabase
    .from("properties")
    .update(patch)
    .eq("id", propertyId)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };
  return {};
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
  "address, owner_name, size_sqft, land_sqft, asset_description, last_sale_date, last_sale_price, custom_fields, field_sources, clear_height_ft, dock_doors, drive_in_doors, power_amps, power_phase, yard_acres, column_spacing, sprinkler_type, availability_status, asking_rent_psf, nnn_cam_psf, lease_structure";

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

  const customExtractFields = await propertyExtractFieldDefs(supabase, user.id);

  const textForGate = content.type === "text" ? content.text : null;
  const allowed = await jevAllowsDocumentExtract({
    address: (existing as { address?: string | null }).address ?? null,
    sourceKind,
    text: textForGate,
  });
  if (!allowed) {
    return {
      error:
        "This source doesn't look like a listing or property document for this address. Try a listing URL, flyer, or paste the page that states the specs.",
    };
  }
  if (textForGate && jevRejectsJunkDocument(await jevClassifyDocument(textForGate))) {
    return {
      error:
        "This source looks like a search page or unrelated document, not a listing or property file for this address.",
    };
  }

  let extracted: ExtractedProperty;
  try {
    extracted = await extractPropertyFields(content, undefined, customExtractFields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI extraction failed: ${msg}` };
  }

  const sources = ((existing as { field_sources?: FieldSources | null }).field_sources) ?? {};

  const diff = computeDocumentDiff(
    existing as unknown as ExistingPropertyForDiff,
    extracted,
    customExtractFields
  );

  return {
    preview: {
      sourceKind,
      sourceDetail,
      changes: diff.changes.filter((e) => !isFieldLocked(sources, e.field)),
      conflicts: diff.conflicts.filter((e) => !isFieldLocked(sources, e.field)),
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

  const customExtractFields = await propertyExtractFieldDefs(supabase, user.id);

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
    if (isFieldLocked(fieldSourcesUpdate, entry.field)) continue;
    if (entry.field.startsWith("custom_fields.")) {
      const slug = entry.field.replace("custom_fields.", "");
      customFieldsUpdate[slug] = entry.rawAfter;
    } else {
      update[entry.field] = entry.rawAfter;
    }
    fieldSourcesUpdate[entry.field] = sourceKind;
  }

  const industrialDefs = await fetchIndustrialFieldDefs(supabase);
  const persist = persistIndustrialFromExtract(industrialDefs, {
    ...extracted,
    custom_fields: customFieldsUpdate,
  });
  for (const [key, value] of Object.entries(persist.columns)) {
    if (isFieldLocked(fieldSourcesUpdate, key)) continue;
    const accepted = toApply.some((e) => {
      if (isFieldLocked(fieldSourcesUpdate, e.field)) return false;
      if (e.field === key) return true;
      if (!e.field.startsWith("custom_fields.")) return false;
      return industrialColumnForSlug(e.field.replace("custom_fields.", "")) === key;
    });
    if (!accepted) continue;
    update[key] = value;
    fieldSourcesUpdate[key] = sourceKind;
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

// ─── Listing discover (search → Jina → address gate → fill-only) ──────────────

const LISTING_DISCOVER_SELECT =
  `address, city, custom_fields, field_sources, ${INDUSTRIAL_SELECT}`;

function industrialColumnsFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const key of INDUSTRIAL_FIELD_KEYS) columns[key] = row[key] ?? null;
  return columns;
}

async function previewListingDiscoverForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  propertyId: string,
): Promise<{ preview: ListingDiscoverPreview } | { error: string }> {
  const { data: existing } = await supabase
    .from("properties")
    .select(LISTING_DISCOVER_SELECT)
    .eq("id", propertyId)
    .eq("owner_id", userId)
    .single();
  if (!existing) return { error: "Property not found." };
  if (!existing.address?.trim()) {
    return { error: "This property needs an address before listing search." };
  }

  const fieldDefs = await propertyExtractFieldDefs(supabase, userId);
  const preview = await discoverListingSpecs({
    address: existing.address,
    city: existing.city,
    fieldDefs,
    existingCustom: (existing.custom_fields as Record<string, string | number | null> | null) ?? {},
    existingColumns: industrialColumnsFromRow(existing as Record<string, unknown>),
    sources: (existing.field_sources as FieldSources | null) ?? {},
  });
  return { preview };
}

export async function previewListingDiscover(
  propertyId: string,
): Promise<{ preview: ListingDiscoverPreview } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  return previewListingDiscoverForUser(supabase, user.id, propertyId);
}

async function applyListingDiscoverForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  propertyId: string,
  acceptedFields: string[],
  preview: ListingDiscoverPreview,
): Promise<{ ok: true; fieldsApplied: number } | { error: string }> {
  const { data: existing } = await supabase
    .from("properties")
    .select(LISTING_DISCOVER_SELECT)
    .eq("id", propertyId)
    .eq("owner_id", userId)
    .single();
  if (!existing) return { error: "Property not found." };

  const planned = planListingApplyWrites(
    preview.candidates,
    acceptedFields,
    (existing.custom_fields as Record<string, string | number | null> | null) ?? {},
    industrialColumnsFromRow(existing as Record<string, unknown>),
    (existing.field_sources as FieldSources | null) ?? {},
  );
  if (planned.fieldsApplied === 0) return { error: "No empty unlocked fields to apply." };

  const { error } = await supabase
    .from("properties")
    .update({
      ...planned.columns,
      custom_fields: planned.custom,
      field_sources: planned.nextSources,
      updated_at: new Date().toISOString(),
    })
    .eq("id", propertyId)
    .eq("owner_id", userId);
  if (error) return { error: error.message };
  return { ok: true, fieldsApplied: planned.fieldsApplied };
}

export async function applyListingDiscover(
  propertyId: string,
  acceptedFields: string[],
  preview: ListingDiscoverPreview,
): Promise<{ ok: true; fieldsApplied: number } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  return applyListingDiscoverForUser(supabase, user.id, propertyId, acceptedFields, preview);
}

export async function fillListingSpecsForProperty(
  propertyId: string,
): Promise<{ preview: ListingDiscoverPreview; fieldsApplied: number } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const previewRes = await previewListingDiscoverForUser(supabase, user.id, propertyId);
  if ("error" in previewRes) return previewRes;
  const { preview } = previewRes;
  if (preview.candidates.length === 0) return { preview, fieldsApplied: 0 };

  const applyRes = await applyListingDiscoverForUser(
    supabase,
    user.id,
    propertyId,
    preview.candidates.map((c) => c.field),
    preview,
  );
  if ("error" in applyRes) return { preview, fieldsApplied: 0 };
  return { preview, fieldsApplied: applyRes.fieldsApplied };
}

export async function enqueueListingDiscover(
  propertyIds: string[],
): Promise<{ ok: true; queued: number } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const ids = [...new Set(propertyIds)].slice(0, 25);
  if (ids.length === 0) return { error: "Select at least one property." };

  const { data: owned } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", user.id)
    .in("id", ids);
  const ownedIds = new Set((owned ?? []).map((p) => p.id));

  let queued = 0;
  for (const id of ids) {
    if (!ownedIds.has(id)) continue;
    const result = await enqueueJob(supabase as never, user.id, "listing_discover", { propertyId: id });
    if (result.error) return { error: result.error };
    queued += 1;
  }
  return { ok: true, queued };
}

export async function runListingDiscoverJob(
  payload: Record<string, unknown>,
): Promise<{ preview: ListingDiscoverPreview; applied: number }> {
  const propertyId = typeof payload.propertyId === "string" ? payload.propertyId : "";
  if (!propertyId) throw new Error("listing_discover job missing propertyId.");
  const result = await fillListingSpecsForProperty(propertyId);
  if ("error" in result) throw new Error(result.error);
  return { preview: result.preview, applied: result.fieldsApplied };
}

export type ListingDiscoverFieldHit = { label: string; value: string | number };

export type ListingDiscoverJobStatus = {
  propertyId: string;
  status: "queued" | "running" | "done" | "failed" | "none";
  candidateCount: number;
  applied: number;
  url: string | null;
  note: string | null;
  error: string | null;
  fields: ListingDiscoverFieldHit[];
  preview: ListingDiscoverPreview | null;
};

export async function getListingDiscoverJobStatuses(
  propertyIds: string[],
): Promise<ListingDiscoverJobStatus[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const ids = [...new Set(propertyIds)].slice(0, 50);
  if (ids.length === 0) return [];

  const { data: jobs } = await supabase
    .from("background_jobs")
    .select("payload, status, last_error, created_at")
    .eq("owner_id", user.id)
    .eq("job_type", "listing_discover")
    .order("created_at", { ascending: false })
    .limit(200);

  const latest = new Map<string, ListingDiscoverJobStatus>();
  for (const job of jobs ?? []) {
    const payload = (job.payload ?? {}) as {
      propertyId?: string;
      preview?: ListingDiscoverPreview;
      applied?: number;
    };
    const propertyId = payload.propertyId;
    if (!propertyId || !ids.includes(propertyId) || latest.has(propertyId)) continue;
    const preview = payload.preview;
    latest.set(propertyId, {
      propertyId,
      status: job.status as ListingDiscoverJobStatus["status"],
      candidateCount: preview?.candidates.length ?? 0,
      applied: payload.applied ?? 0,
      url: preview?.url ?? null,
      note: preview?.note ?? null,
      error: job.last_error,
      fields: (preview?.candidates ?? []).map((c) => ({ label: c.label, value: c.value })),
      preview: preview ?? null,
    });
  }

  return ids.map((propertyId) => latest.get(propertyId) ?? {
    propertyId,
    status: "none",
    candidateCount: 0,
    applied: 0,
    url: null,
    note: null,
    error: null,
    fields: [],
    preview: null,
  });
}

/** Apply a stored listing preview that was never written (older jobs). */
export async function finalizeListingDiscoverIfNeeded(
  propertyId: string,
): Promise<ListingDiscoverJobStatus | null> {
  const [status] = await getListingDiscoverJobStatuses([propertyId]);
  if (!status || status.status !== "done" || !status.preview) return status ?? null;
  if (status.applied > 0 || status.preview.candidates.length === 0) return status;

  const apply = await applyListingDiscover(
    propertyId,
    status.preview.candidates.map((c) => c.field),
    status.preview,
  );
  const applied = "error" in apply ? 0 : apply.fieldsApplied;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: jobs } = await supabase
      .from("background_jobs")
      .select("id, payload")
      .eq("owner_id", user.id)
      .eq("job_type", "listing_discover")
      .order("created_at", { ascending: false })
      .limit(50);
    const job = (jobs ?? []).find((row) => {
      const payload = (row.payload ?? {}) as { propertyId?: string };
      return payload.propertyId === propertyId;
    });
    if (job) {
      await supabase
        .from("background_jobs")
        .update({ payload: { ...(job.payload ?? {}), applied } })
        .eq("id", job.id)
        .eq("owner_id", user.id);
    }
  }

  return { ...status, applied };
}

// ─── Zoning ───────────────────────────────────────────────────────────────────

function countyFromSourceUrl(sourceUrl: string | null): SupportedCounty | null {
  if (sourceUrl?.startsWith("mdpa:")) return "miami-dade";
  if (sourceUrl?.startsWith("bcpa:")) return "broward";
  if (sourceUrl?.startsWith("pbcpa:")) return "palm-beach";
  if (sourceUrl?.startsWith("magis:")) return "massachusetts";
  return null;
}

function stripCountyPrefix(sourceUrl: string | null): string | null {
  const m = sourceUrl?.match(/^(mdpa|bcpa|pbcpa|magis):(.+)$/);
  return m ? m[2] : null;
}

export async function getPropertyZoning(
  propertyId: string
): Promise<{ result: ZoningResult } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop } = await supabase
    .from("properties")
    .select("address, city, source_url")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!prop) return { error: "Property not found." };
  if (!prop.address?.trim()) return { error: "This property has no address to look up." };

  // Prefer the county already recorded from a prior county-enhancement run
  // (source_url's mdpa:/bcpa:/pbcpa:/magis: prefix) — it also carries the
  // exact strap/folio, which lets Miami-Dade and Broward skip geocoding
  // entirely. Fall back to city-based detection for properties that haven't
  // been through county enhancement yet.
  const county = countyFromSourceUrl(prop.source_url) ?? detectCounty(prop.city ?? "");
  if (!county) {
    return {
      error: "This address appears to be outside our current coverage (Miami-Dade, Broward, and Palm Beach counties; Boston-metro Massachusetts).",
    };
  }
  const strap = stripCountyPrefix(prop.source_url);

  const result = await runAndPersistZoning(supabase, user.id, propertyId, {
    county, address: prop.address, city: prop.city, strap,
  });

  return { result };
}
