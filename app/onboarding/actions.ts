"use server";

import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import {
  applyPropertyMapping,
  applyContactMapping,
  type Mapping,
  type ParsedFile,
  type ImportResult,
} from "@/lib/import-mapper";
import { upsertProperty } from "@/lib/property-ingest";

const MAX_ROWS = 500;

// ─── Parse uploaded file → headers + rows ─────────────────────────────────────

export async function parseImportFile(
  formData: FormData
): Promise<ParsedFile | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file provided." };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    return { error: "Please upload a CSV or Excel file (.csv, .xlsx, .xls)." };
  }

  let workbook: XLSX.WorkBook;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    workbook = XLSX.read(buffer, { type: "buffer", cellText: true, raw: false });
  } catch {
    return { error: "Could not parse the file. Make sure it is a valid CSV or Excel file." };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: "",
    raw: false,
  });

  if (rawRows.length === 0) {
    return { error: "The file is empty or has no readable rows." };
  }

  const headers = Object.keys(rawRows[0]);
  const rows = rawRows.slice(0, MAX_ROWS) as Record<string, string>[];
  const preview = rows
    .slice(0, 5)
    .map((r) => headers.map((h) => String(r[h] ?? "")));

  return {
    headers,
    preview,
    rows,
    totalRows: rawRows.length,
    truncated: rawRows.length > MAX_ROWS,
  };
}

// ─── Run the import with a confirmed mapping ──────────────────────────────────

export async function runImport(params: {
  entityType: "property" | "contact";
  rows: Record<string, string>[];
  mapping: Mapping;
}): Promise<ImportResult | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { entityType, rows, mapping } = params;

  if (entityType === "property") {
    return importProperties(supabase, user.id, rows, mapping);
  }
  return importContacts(supabase, user.id, rows, mapping);
}

async function importProperties(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  rows: Record<string, string>[],
  mapping: Mapping
): Promise<ImportResult> {
  let propertiesImported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    const mapped = applyPropertyMapping(row, mapping);
    if (!mapped) { skipped++; continue; }

    try {
      await upsertProperty(supabase, userId, {
        owner_id: userId,
        address: mapped.address,
        city: mapped.city,
        submarket: mapped.submarket,
        owner_name: mapped.owner_name,
        ownership_type: mapped.ownership_type,
        property_type: mapped.property_type,
        size_sqft: mapped.size_sqft,
        last_sale_date: mapped.last_sale_date,
        last_sale_price: mapped.last_sale_price,
        building_composition: {},
        source: "csv_import",
        source_url: mapped.source_url,
        ingested_at: now,
        confidence_flags: [],
      });
      propertiesImported++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { propertiesImported, contactsImported: 0, skipped, errors };
}

async function importContacts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  rows: Record<string, string>[],
  mapping: Mapping
): Promise<ImportResult> {
  // Pre-fetch existing emails for dedup
  const { data: existing } = await supabase
    .from("contacts")
    .select("email")
    .eq("owner_id", userId)
    .not("email", "is", null);

  const existingEmails = new Set<string>(
    (existing ?? [])
      .map((c: { email: string }) => (c.email ?? "").toLowerCase())
      .filter(Boolean)
  );

  let contactsImported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const batchEmails = new Set<string>();

  for (const row of rows) {
    const mapped = applyContactMapping(row, mapping);
    if (!mapped) { skipped++; continue; }

    const emailKey = mapped.email?.toLowerCase() ?? null;

    if (emailKey && (existingEmails.has(emailKey) || batchEmails.has(emailKey))) {
      skipped++;
      continue;
    }

    try {
      const { error } = await supabase.from("contacts").insert({
        owner_id: userId,
        name: mapped.name,
        company: mapped.company ?? null,
        email: mapped.email ?? null,
        phone_mobile: mapped.phone ?? null,
        contact_tier: mapped.contact_tier ?? 3,
        ownership_type: mapped.ownership_type,
        role: mapped.role ?? null,
      });
      if (error) throw new Error(error.message);
      if (emailKey) batchEmails.add(emailKey);
      contactsImported++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { propertiesImported: 0, contactsImported, skipped, errors };
}

// ─── Mark onboarding complete ─────────────────────────────────────────────────

export async function completeOnboarding(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      {
        owner_id: user.id,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" }
    );

  return error ? { error: error.message } : {};
}
