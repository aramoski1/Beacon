"use server";

import { createClient } from "@/lib/supabase/server";
import { searchAndExtractSunbiz, type SunbizResult, type SunbizPerson } from "@/lib/sunbiz";
import { logIngestionError } from "@/lib/ingestion-logger";
import { extractCoStarOwner, type CoStarOwner, type CoStarContact, type CoStarFileContent } from "@/lib/costar";

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

// ─── Create contacts from Sunbiz persons ─────────────────────────────────────

export type SunbizCreateAction =
  | { error: string }
  | { created: number; ids: string[] };

export async function createSunbizContacts(
  propertyId: string,
  persons: SunbizPerson[]
): Promise<SunbizCreateAction> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Verify property ownership (defense-in-depth)
  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .single();
  if (!prop) return { error: "Property not found." };

  const ids: string[] = [];
  for (const person of persons) {
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner_id: user.id,
        name: person.name.trim(),
        role: person.title.trim() || null,
        mailing_address: person.address ?? null,
        linked_properties: [propertyId],
        action_tags: ["sunbiz", "unverified"],
        outreach_history: [],
        custom_fields: {},
      })
      .select("id")
      .single();

    if (!error && data) ids.push(data.id);
  }

  return { created: ids.length, ids };
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
