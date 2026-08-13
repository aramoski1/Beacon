// Pure Sunbiz URL builder — no Node built-ins, safe to import from client
// components as well as lib/sunbiz.ts's server-only scraper.

export const SUNBIZ_BASE = "https://search.sunbiz.org";

// Sunbiz uses a path-based results URL: /SearchResults/EntityName/{name}/Page1
// The searchNameOrder param is the name uppercased, de-punctuated, without
// common entity-type suffixes — used by Sunbiz as the initial alpha sort cursor.
export function buildSunbizSearchUrl(entityName: string): string {
  const encoded = encodeURIComponent(entityName);
  // Strip periods first so "L.L.C." → "LLC" before the suffix removal pattern.
  const order = entityName
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/[,\s]+(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\s*$/i, "")
    .replace(/[^A-Z0-9]/g, "");
  return (
    `${SUNBIZ_BASE}/Inquiry/CorporationSearch/SearchResults/EntityName/${encoded}/Page1` +
    `?searchNameOrder=${order}`
  );
}

/**
 * The same results URL the scraper hits, safe to hand to a broker as a plain
 * link when the automated lookup fails — it's a normal browser navigation,
 * not a curl request, so Cloudflare's TLS-fingerprint block (what makes the
 * automated scrape fail) never triggers for a real browser tab.
 */
export function manualSunbizSearchUrl(entityName: string): string {
  return buildSunbizSearchUrl(entityName);
}
