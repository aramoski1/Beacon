// Pure CSV import mapping utilities — no server imports, safe in client and server.
// Handles column auto-suggestion, row transformation, and within-file deduplication.

// ─── Field definitions ────────────────────────────────────────────────────────

export type CsvFieldDef = {
  label: string;
  required?: boolean;
  aliases: string[];
};

export const PROPERTY_FIELDS: Record<string, CsvFieldDef> = {
  address:         { label: "Address",          required: true,  aliases: ["street", "property address", "addr", "location", "property"] },
  city:            { label: "City",             aliases: ["municipality", "market", "town"] },
  submarket:       { label: "Submarket",        aliases: ["neighborhood", "district", "zone", "area"] },
  owner_name:      { label: "Owner Name",       aliases: ["owner", "landlord", "property owner", "ownership entity"] },
  ownership_type:  { label: "Ownership Type",   aliases: ["owner type", "entity type"] },
  property_type:   { label: "Property Type",    aliases: ["type", "asset type", "building type", "class", "use type"] },
  size_sqft:       { label: "Size (sq ft)",     aliases: ["sqft", "sf", "sq ft", "size", "rsf", "rentable", "gla", "nra", "area", "building area"] },
  last_sale_price: { label: "Last Sale Price",  aliases: ["sale price", "purchase price", "sold for", "price", "transaction price"] },
  last_sale_date:  { label: "Last Sale Date",   aliases: ["sale date", "purchase date", "sold date", "transfer date"] },
  source_url:      { label: "Source URL",       aliases: ["url", "link", "listing url", "source", "web url"] },
};

export const CONTACT_FIELDS: Record<string, CsvFieldDef> = {
  name:            { label: "Full Name",        required: true,  aliases: ["contact", "person", "full name", "contact name"] },
  company:         { label: "Company",          aliases: ["firm", "org", "employer", "organization", "company name", "brokerage"] },
  email:           { label: "Email",            aliases: ["email address", "e-mail", "mail"] },
  phone:           { label: "Phone",            aliases: ["mobile", "cell", "telephone", "phone number", "cell phone"] },
  contact_tier:    { label: "Tier (1–3)",       aliases: ["tier", "priority", "rank", "tier level"] },
  ownership_type:  { label: "Ownership Type",   aliases: ["owner type", "profile type", "entity type"] },
  role:            { label: "Title / Role",     aliases: ["title", "job title", "position", "occupation"] },
};

// Mapping: fieldKey → CSV header name (undefined / "" = skip)
export type Mapping = Record<string, string>;

export type ParsedFile = {
  headers: string[];
  preview: string[][];
  rows: Record<string, string>[];
  totalRows: number;
  truncated: boolean;
};

export type ImportResult = {
  propertiesImported: number;
  contactsImported: number;
  skipped: number;
  errors: string[];
  /** Property IDs written in this import (for optional post-import enrich). */
  importedPropertyIds?: string[];
};

// ─── Auto-suggest ─────────────────────────────────────────────────────────────

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function bestScore(header: string, key: string, def: CsvFieldDef): number {
  const h = normalizeToken(header);
  const kn = normalizeToken(key.replace(/_/g, " "));
  const ln = normalizeToken(def.label);

  if (h === kn || h === ln) return 100;
  if (h.includes(kn) || kn.includes(h)) return 75;
  if (h.includes(ln) || ln.includes(h)) return 70;
  for (const alias of def.aliases) {
    const an = normalizeToken(alias);
    if (h === an) return 95;
    if (h.includes(an) || an.includes(h)) return 60;
  }
  return 0;
}

export function autoSuggestMapping(
  headers: string[],
  entityType: "property" | "contact"
): Mapping {
  const fields = entityType === "property" ? PROPERTY_FIELDS : CONTACT_FIELDS;

  // Score every field-header pair, then assign greedily from best score down.
  // This prevents lower-scoring fields from stealing headers from better matches.
  type Candidate = { fieldKey: string; header: string; score: number };
  const candidates: Candidate[] = [];

  for (const [key, def] of Object.entries(fields)) {
    for (const h of headers) {
      const s = bestScore(h, key, def);
      if (s >= 60) candidates.push({ fieldKey: key, header: h, score: s });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const result: Mapping = {};
  const usedHeaders = new Set<string>();
  const usedFields = new Set<string>();

  for (const { fieldKey, header } of candidates) {
    if (usedHeaders.has(header) || usedFields.has(fieldKey)) continue;
    result[fieldKey] = header;
    usedHeaders.add(header);
    usedFields.add(fieldKey);
  }

  return result;
}

// ─── Normalization helpers ────────────────────────────────────────────────────

function cell(row: Record<string, string>, header: string | undefined): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

function parseNum(v: string): number | null {
  const n = parseFloat(v.replace(/[$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

const OWNERSHIP_MAP: [string, string][] = [
  ["reit",          "REIT"],
  ["llc",           "institutional"], ["inc",      "institutional"],
  ["corp",          "institutional"], ["trust",    "institutional"],
  ["fund",          "institutional"], ["gov",      "institutional"],
  ["individual",    "private"],       ["personal", "private"],
  ["private",       "private"],       ["person",   "private"],
  ["owner-occupant","owner-occupant"],["occupant", "owner-occupant"],
];

function normalizeOwnershipType(v: string): string {
  const l = v.toLowerCase();
  for (const [k, out] of OWNERSHIP_MAP) if (l.includes(k)) return out;
  return "unknown";
}

const PROPERTY_TYPE_MAP: [string, string][] = [
  ["industrial", "industrial"], ["warehouse", "industrial"], ["flex", "industrial"],
  ["office",     "office"],     ["medical",   "office"],
  ["retail",     "retail"],     ["restaurant","retail"],     ["shopping", "retail"],
  ["multifamily","multifamily"],["apartment", "multifamily"],
  ["residential","residential"],
  ["land",       "land"],       ["vacant",    "land"],
  ["mixed",      "mixed-use"],
];

function normalizePropertyType(v: string): string {
  const l = v.toLowerCase();
  for (const [k, out] of PROPERTY_TYPE_MAP) if (l.includes(k)) return out;
  return "other";
}

export function normalizeContactTier(v: string): number | null {
  const l = v.toLowerCase().trim();
  if (l === "1" || l === "tier 1" || l === "a" || l.includes("high") || l.includes("priority")) return 1;
  if (l === "2" || l === "tier 2" || l === "b" || l.includes("medium") || l.includes("warm"))   return 2;
  if (l === "3" || l === "tier 3" || l === "c" || l.includes("low")  || l.includes("cold"))     return 3;
  const n = parseInt(l, 10);
  return [1, 2, 3].includes(n) ? n : null;
}

// ─── Types for transformed rows ───────────────────────────────────────────────

export type MappedProperty = {
  address: string;
  city: string | null;
  submarket: string | null;
  owner_name: string | null;
  ownership_type: string;
  property_type: string;
  size_sqft: number | null;
  last_sale_price: number | null;
  last_sale_date: string | null;
  source_url: string | null;
};

export type MappedContact = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  contact_tier: number | null;
  ownership_type: string;
  role: string | null;
};

// ─── Row transformation ───────────────────────────────────────────────────────

export function applyPropertyMapping(
  row: Record<string, string>,
  mapping: Mapping
): MappedProperty | null {
  const address = cell(row, mapping.address);
  if (!address) return null;
  return {
    address,
    city:            cell(row, mapping.city)           || null,
    submarket:       cell(row, mapping.submarket)      || null,
    owner_name:      cell(row, mapping.owner_name)     || null,
    ownership_type:  normalizeOwnershipType(cell(row, mapping.ownership_type)),
    property_type:   normalizePropertyType(cell(row, mapping.property_type)),
    size_sqft:       parseNum(cell(row, mapping.size_sqft)),
    last_sale_price: parseNum(cell(row, mapping.last_sale_price)),
    last_sale_date:  cell(row, mapping.last_sale_date) || null,
    source_url:      cell(row, mapping.source_url)     || null,
  };
}

export function applyContactMapping(
  row: Record<string, string>,
  mapping: Mapping
): MappedContact | null {
  const name = cell(row, mapping.name);
  if (!name) return null;
  return {
    name,
    company:       cell(row, mapping.company)       || null,
    email:         cell(row, mapping.email)         || null,
    phone:         cell(row, mapping.phone)         || null,
    contact_tier:  normalizeContactTier(cell(row, mapping.contact_tier)),
    ownership_type:normalizeOwnershipType(cell(row, mapping.ownership_type)),
    role:          cell(row, mapping.role)          || null,
  };
}

// ─── Within-file deduplication ────────────────────────────────────────────────

export function normalizeAddress(addr: string): string {
  return addr.toUpperCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();
}

export function deduplicateProperties(rows: MappedProperty[]): {
  unique: MappedProperty[];
  duplicates: MappedProperty[];
} {
  const seen = new Set<string>();
  const unique: MappedProperty[] = [];
  const duplicates: MappedProperty[] = [];
  for (const row of rows) {
    const key = normalizeAddress(row.address);
    if (seen.has(key)) { duplicates.push(row); } else { seen.add(key); unique.push(row); }
  }
  return { unique, duplicates };
}

export function deduplicateContacts(rows: MappedContact[]): {
  unique: MappedContact[];
  duplicates: MappedContact[];
} {
  const seenEmails = new Set<string>();
  const seenNames  = new Set<string>();
  const unique: MappedContact[] = [];
  const duplicates: MappedContact[] = [];

  for (const row of rows) {
    const email = row.email?.toLowerCase().trim() ?? null;
    const nameKey = [row.name.toLowerCase().trim(), (row.company ?? "").toLowerCase().trim()]
      .filter(Boolean).join("||");

    const isDup = email ? seenEmails.has(email) : seenNames.has(nameKey);
    if (isDup) {
      duplicates.push(row);
    } else {
      if (email) seenEmails.add(email);
      seenNames.add(nameKey);
      unique.push(row);
    }
  }
  return { unique, duplicates };
}
