// Shared dedup + upsert logic used by every property ingestion path.

// ─── Address normalisation ────────────────────────────────────────────────────

// Strips suite/unit/city/state/zip so "200 S BISCAYNE BLVD STE 100, Miami FL"
// and "200 S Biscayne Blvd" both reduce to "200 S BISCAYNE BLVD".
export function normalizeAddress(raw: string): string {
  return raw
    .split(",")[0]                  // drop everything after first comma
    .replace(/\b(ste|suite|apt|unit|#)\s*\S+/gi, "") // strip unit suffix
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// ─── Deduplication ────────────────────────────────────────────────────────────

// Returns the existing property id if a duplicate is found, otherwise null.
// Priority:
//   1. Exact source_url match  (folio ref "mdpa:XX-…" or original listing URL)
//   2. Case-insensitive address match  (catches same property from different sources)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findDuplicate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  sourceUrl: string | null,
  address: string | null
): Promise<string | null> {
  if (sourceUrl) {
    const { data } = await supabase
      .from("properties")
      .select("id")
      .eq("owner_id", userId)
      .eq("source_url", sourceUrl)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  if (address) {
    const normalized = normalizeAddress(address);
    if (normalized.length > 3) {
      const { data } = await supabase
        .from("properties")
        .select("id")
        .eq("owner_id", userId)
        .ilike("address", normalized)
        .maybeSingle();
      if (data?.id) return data.id as string;
    }
  }

  return null;
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

export type PropertyPayload = {
  owner_id: string;
  address: string | null;
  city: string | null;
  submarket?: string | null;
  owner_name: string | null;
  ownership_type: string | null;
  size_sqft: number | null;
  property_type: string | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  building_composition: Record<string, unknown> | null;
  source: string;
  source_url: string | null;
  ingested_at: string;
  confidence_flags: { field: string; reason: string }[];
  custom_fields?: Record<string, unknown>;
};

// Inserts or updates depending on dedup result. Returns the record id.
export async function upsertProperty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  payload: PropertyPayload
): Promise<string> {
  const existingId = await findDuplicate(
    supabase,
    userId,
    payload.source_url,
    payload.address
  );

  if (existingId) {
    const { error } = await supabase
      .from("properties")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", existingId);
    if (error) throw new Error(`DB update failed: ${error.message}`);
    return existingId;
  }

  const { data, error } = await supabase
    .from("properties")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data.id as string;
}
