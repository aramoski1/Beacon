// Find a public listing page for an address, fetch it (Jina), gate on address
// match, then reuse extractPropertyFields. Writes never happen here — callers
// preview and apply fill-only via field-lock.

import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { AUTHORITATIVE_PROPERTY_FIELDS } from "@/lib/document-enhancement";
import {
  hasFieldValue,
  isFieldLocked,
  isProtectedFromAutoWrite,
  type FieldSources,
} from "@/lib/field-lock";
import { industrialFromExtracted, type IndustrialExtractSource } from "@/lib/industrial-extract";
import { INDUSTRIAL_COLUMN_BY_SLUG, industrialColumnForSlug } from "@/lib/industrial-fields";
import { fetchListingText } from "@/lib/listing-fetch";
import { extractPropertyFields, type ExtractedProperty } from "@/lib/property-pipeline";

export const LISTING_DISCOVER_SYSTEM_PROMPT =
  "Extract ONLY fields the listing page explicitly states. Do not infer docks, clear height, power, asking rent, or any industrial spec from lot size, tax-roll language, or a typical warehouse. If the page does not state a spec, leave it null.";

const STREET_SUFFIXES = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "dr", "drive", "blvd", "boulevard",
  "ct", "court", "ln", "lane", "way", "pkwy", "parkway", "hwy", "highway",
  "pl", "place", "ter", "terrace", "cir", "circle",
]);

const DIRECTIONS = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west",
]);

const SKIP_HOST_PARTS = [
  "facebook.", "youtube.", "youtu.be", "twitter.", "x.com", "instagram.",
  "tiktok.", "reddit.", "linkedin.", "wikipedia.", "google.", "bing.com",
  "miamidade.gov", "bcpa.net", "pbcgov", "mass.gov",
  "zillow.com", "redfin.com", "realtor.com",
];

const MAX_SEARCH_RESULTS = 8;
const MAX_FETCH_PAGES = 4;

export type ListingCitation = {
  url: string;
  excerpt: string;
  field: string;
};

export type ListingDiscoverCandidate = {
  field: string;
  column: string | null;
  label: string;
  value: string | number;
  citation: ListingCitation;
};

export type ListingDiscoverPreview = {
  url: string | null;
  note: string | null;
  skippedPages: number;
  candidates: ListingDiscoverCandidate[];
};

export function normalizeAddressText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function listingSearchQuery(address: string, city: string | null): string {
  const addr = address.trim();
  const cityPart = city?.trim() ? ` "${city.trim()}"` : "";
  return `"${addr}"${cityPart} (industrial OR warehouse OR "clear height" OR docks OR Crexi OR LoopNet)`;
}

export function isJunkListingUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SKIP_HOST_PARTS.some((part) => host.includes(part.replace(/\.$/, "")) || host.includes(part));
  } catch {
    return true;
  }
}

export function addressMatchesPage(
  address: string,
  _city: string | null,
  pageText: string,
): boolean {
  const a = normalizeAddressText(address);
  const text = normalizeAddressText(pageText);
  const parts = a.split(" ").filter(Boolean);
  const streetNum = parts[0];
  if (!streetNum || !/^\d+[a-z]?$/.test(streetNum)) return false;
  if (!text.includes(streetNum)) return false;

  const streetToken = parts.slice(1).find(
    (p) => p.length >= 3 && !STREET_SUFFIXES.has(p) && !DIRECTIONS.has(p),
  );
  if (streetToken) return text.includes(streetToken);
  return parts[1] != null && text.includes(parts[1]);
}

export function excerptAround(pageText: string, needle: string, radius = 48): string | null {
  const n = needle.trim();
  if (!n) return null;
  const hay = pageText.toLowerCase();
  const idx = hay.indexOf(n.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(pageText.length, idx + n.length + radius);
  return pageText.slice(start, end).replace(/\s+/g, " ").trim();
}

export function excerptForValue(pageText: string, value: string | number): string | null {
  const raw = String(value).trim();
  if (!raw) return null;
  const candidates = [raw];
  if (typeof value === "number") {
    candidates.push(`${value}'`, `${value} ft`, `${value}ft`, value.toLocaleString("en-US"));
  }
  for (const needle of candidates) {
    const excerpt = excerptAround(pageText, needle);
    if (excerpt) return excerpt;
  }
  return null;
}

export function uniqueHttpUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) continue;
    if (isJunkListingUrl(parsed.toString())) continue;
    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function parseBraveUrls(json: unknown): string[] {
  const web = (json as { web?: { results?: { url?: string }[] } })?.web?.results ?? [];
  return uniqueHttpUrls(web.map((r) => r.url ?? "").filter(Boolean));
}

export function parseSerperUrls(json: unknown): string[] {
  const organic = (json as { organic?: { link?: string }[] })?.organic ?? [];
  return uniqueHttpUrls(organic.map((r) => r.link ?? "").filter(Boolean));
}

export function parseDdgHtmlUrls(html: string): string[] {
  const urls: string[] = [];
  const uddg = /uddg=([^&"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = uddg.exec(html))) {
    try {
      urls.push(decodeURIComponent(m[1]));
    } catch {
      // skip malformed
    }
  }
  const hrefRe = /class="result__a"[^>]*href="([^"]+)"/g;
  while ((m = hrefRe.exec(html))) {
    urls.push(m[1]);
  }
  return uniqueHttpUrls(urls);
}

export async function searchListingUrls(query: string): Promise<string[]> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_SEARCH_RESULTS}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": braveKey,
      },
    });
    if (res.ok) return parseBraveUrls(await res.json()).slice(0, MAX_SEARCH_RESULTS);
  }

  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: MAX_SEARCH_RESULTS }),
    });
    if (res.ok) return parseSerperUrls(await res.json()).slice(0, MAX_SEARCH_RESULTS);
  }

  const ddg = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "BeaconListingDiscover/1.0" },
  });
  if (!ddg.ok) return [];
  return parseDdgHtmlUrls(await ddg.text()).slice(0, MAX_SEARCH_RESULTS);
}

export function buildListingCandidates(
  extracted: ExtractedProperty,
  fieldDefs: FieldDefinition[],
  existingCustom: Record<string, string | number | null> | null,
  existingColumns: Record<string, unknown>,
  sources: FieldSources | null | undefined,
  pageText: string,
  url: string,
): ListingDiscoverCandidate[] {
  const industrial = industrialFromExtracted(extracted as IndustrialExtractSource);
  const candidates: ListingDiscoverCandidate[] = [];

  for (const def of fieldDefs) {
    if (def.fill_mode !== "extract") continue;
    const slug = fieldSlug(def.field_name);
    const field = `custom_fields.${slug}`;
    const col = industrialColumnForSlug(slug) ?? INDUSTRIAL_COLUMN_BY_SLUG[slug] ?? null;
    const existingValue = existingCustom?.[slug] ?? (col ? existingColumns[col] : null);
    if (isProtectedFromAutoWrite(sources, field, existingValue)) continue;
    if (hasFieldValue(existingValue)) continue;

    const incoming =
      extracted.custom_fields?.[slug] ??
      (col ? industrial[col] : null) ??
      null;
    if (!hasFieldValue(incoming) || incoming == null) continue;

    const excerpt = excerptForValue(pageText, incoming);
    if (!excerpt) continue;

    candidates.push({
      field,
      column: col,
      label: def.field_name,
      value: incoming,
      citation: { url, excerpt, field },
    });
  }

  return candidates;
}

/** Server-side apply plan. Never trusts client `column` — derive it from the slug. */
export function planListingApplyWrites(
  candidates: ListingDiscoverCandidate[],
  acceptedFields: string[],
  existingCustom: Record<string, string | number | null>,
  existingColumns: Record<string, unknown>,
  sources: FieldSources | null | undefined,
): {
  custom: Record<string, string | number | null>;
  columns: Record<string, string | number>;
  nextSources: FieldSources;
  fieldsApplied: number;
} {
  const accepted = new Set(acceptedFields);
  const custom = { ...existingCustom };
  const columns: Record<string, string | number> = {};
  const nextSources: FieldSources = { ...(sources ?? {}) };
  let fieldsApplied = 0;

  for (const candidate of candidates) {
    if (!accepted.has(candidate.field)) continue;
    if (!candidate.field.startsWith("custom_fields.")) continue;
    if (!candidate.citation?.excerpt || !candidate.citation.url) continue;
    if (!hasFieldValue(candidate.value)) continue;
    if (isFieldLocked(sources, candidate.field)) continue;

    const slug = candidate.field.slice("custom_fields.".length);
    if (!slug || AUTHORITATIVE_PROPERTY_FIELDS.has(slug)) continue;
    const column = industrialColumnForSlug(slug);
    if (column && AUTHORITATIVE_PROPERTY_FIELDS.has(column)) continue;

    const existingCustomValue = custom[slug];
    const existingCol = column ? existingColumns[column] : null;
    if (hasFieldValue(existingCustomValue) || hasFieldValue(existingCol)) continue;

    custom[slug] = candidate.value;
    nextSources[candidate.field] = "web";
    if (column) {
      columns[column] = candidate.value;
      nextSources[column] = "web";
    }
    fieldsApplied += 1;
  }

  return { custom, columns, nextSources, fieldsApplied };
}

export type DiscoverListingInput = {
  address: string;
  city: string | null;
  fieldDefs: FieldDefinition[];
  existingCustom: Record<string, string | number | null> | null;
  existingColumns: Record<string, unknown>;
  sources: FieldSources | null | undefined;
};

export async function discoverListingSpecs(
  input: DiscoverListingInput,
): Promise<ListingDiscoverPreview> {
  const query = listingSearchQuery(input.address, input.city);
  let urls: string[] = [];
  try {
    urls = await searchListingUrls(query);
  } catch {
    return {
      url: null,
      note: "Search failed. Set BRAVE_SEARCH_API_KEY or SERPER_API_KEY, or try again.",
      skippedPages: 0,
      candidates: [],
    };
  }

  if (urls.length === 0) {
    return {
      url: null,
      note: "No public listing pages found for this address.",
      skippedPages: 0,
      candidates: [],
    };
  }

  let skippedPages = 0;
  for (const url of urls.slice(0, MAX_FETCH_PAGES)) {
    let pageText: string;
    try {
      pageText = await fetchListingText(url);
    } catch {
      skippedPages += 1;
      continue;
    }

    if (!addressMatchesPage(input.address, input.city, pageText)) {
      skippedPages += 1;
      continue;
    }

    let extracted: ExtractedProperty;
    try {
      extracted = await extractPropertyFields(
        { type: "text", text: pageText, hint: `from public listing URL: ${url}` },
        LISTING_DISCOVER_SYSTEM_PROMPT,
        input.fieldDefs,
      );
    } catch {
      skippedPages += 1;
      continue;
    }

    const candidates = buildListingCandidates(
      extracted,
      input.fieldDefs,
      input.existingCustom,
      input.existingColumns,
      input.sources,
      pageText,
      url,
    );

    if (candidates.length === 0) {
      return {
        url,
        note: "A listing page matched this address, but it did not state any empty unlocked specs we can cite.",
        skippedPages,
        candidates: [],
      };
    }

    return { url, note: null, skippedPages, candidates };
  }

  return {
    url: null,
    note: "Found pages, but none clearly matched this address or stated empty specs.",
    skippedPages,
    candidates: [],
  };
}
