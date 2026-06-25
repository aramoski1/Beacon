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
import { extractPropertyFields, type ExtractedProperty } from "@/lib/property-pipeline";

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
      linked_properties: [propertyId],
      action_tags: ["mdpa_mailing", "unverified"],
      outreach_history: [],
      custom_fields: {},
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
    .select("owner_contacts, owner_name, owner_mailing_address")
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
      linked_properties: [propertyId],
      action_tags: ["sunbiz", "unverified"],
      outreach_history: [],
      custom_fields: {},
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

// ─── CoStar file upload enrichment ───────────────────────────────────────────

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

    if (!error && data) ids.push(data.id);
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
  changes: EnhancementDiffEntry[];
  unchanged: EnhancementDiffEntry[];
  mdpaData: MdpaEnhancementData;
  sunbiz_result: import("@/lib/sunbiz").SunbizResult | null;
  sunbiz_error: string | null;
};

// Step 1: GIS address search for an existing property
export async function initiateCountyEnhancement(
  propertyId: string
): Promise<{ matches: { strap: string; address: string }[] } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: prop } = await supabase
    .from("properties")
    .select("address, source, source_url")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!prop) return { error: "Property not found." };
  if (prop.source === "tax_roll") {
    return { error: "This property is already sourced from the Miami-Dade Property Appraiser." };
  }
  if (prop.source_url?.startsWith("mdpa:")) {
    return { error: "This property has already been enhanced with county data." };
  }
  if (!prop.address?.trim()) {
    return { error: "This property has no address to search." };
  }

  try {
    const parcels = await searchByAddressGIS(prop.address.trim());
    if (parcels.length === 0) {
      return {
        error:
          "No Miami-Dade parcel found for this address. Verify the street number and name. This feature only supports Miami-Dade County properties.",
      };
    }
    return { matches: parcels.map((p) => ({ strap: p.strap, address: p.address })) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Miami-Dade property search failed: ${msg}` };
  }
}

// Step 2: Fetch MDPA detail, extract fields, compute before/after diff
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
      []
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI extraction failed: ${msg}` };
  }

  const owner_mailing_address = extractOwnerMailing(detail);
  const bc = fields.building_composition;
  const land_sqft = bc?.lot_size_sqft != null ? Math.round(bc.lot_size_sqft as number) : null;
  const asset_description = (bc?.dor_description as string | null | undefined) ?? null;

  const mdpaData: MdpaEnhancementData = {
    owner_name: fields.owner_name,
    size_sqft: fields.size_sqft,
    last_sale_date: fields.last_sale_date || null,
    last_sale_price: fields.last_sale_price ?? null,
    building_composition: bc as Record<string, unknown> | null,
    owner_mailing_address,
    land_sqft,
    asset_description,
  };

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
    { field: "building_composition.dor_code",       label: "DOR code",        before: (existingBc?.dor_code as string | null) ?? null,                             after: bc?.dor_code ?? null },
    { field: "building_composition.assessed_value", label: "Assessed value",  before: fmtN(existingBc?.assessed_value as number | null, currency),               after: fmtN(bc?.assessed_value as number | null, currency) },
  ];

  const changes   = allFields.filter((f) => f.before !== f.after);
  const unchanged = allFields.filter((f) => f.before === f.after && (f.before !== null || f.after !== null));

  // Auto Sunbiz: same logic as ingestChosenFolio — non-blocking, never prevents preview returning
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

  return { preview: { strap, siteAddress, changes, unchanged, mdpaData, sunbiz_result, sunbiz_error } };
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
    .select("id, confidence_flags")
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
  const remainingFlags = (
    (existing.confidence_flags ?? []) as { field: string; reason: string }[]
  ).filter((f) => !MDPA_FIELDS.has(f.field));

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
      source_url:            `mdpa:${strap}`,
      confidence_flags:      remainingFlags,
      ingested_at:           new Date().toISOString(),
    })
    .eq("id", propertyId)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };

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
