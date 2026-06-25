// Florida Division of Corporations public records scraper.
// search.sunbiz.org has no API — this scrapes the public HTML.
// URL format as of June 2026: GET /SearchResults/EntityName/{name}/Page1
// (old SearchResults?inquiryType=...&searchTerm=... GET endpoint is gone;
//  new ByName POST endpoint returns a redirect to the path-based GET URL).

import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomBytes } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { unlink } from "fs/promises";
import type { SunbizMatch, SunbizPerson, SunbizResult, SunbizLookup } from "./sunbiz-types";
import {
  storedOwnerContactsFromSunbiz,
  parseStoredOwnerContacts,
  type StoredOwnerContact,
} from "./owner-contacts";

export type { SunbizMatch, SunbizPerson, SunbizResult, SunbizLookup, StoredOwnerContact };
export { storedOwnerContactsFromSunbiz, parseStoredOwnerContacts };

const execFileAsync = promisify(execFile);

const SUNBIZ_BASE = "https://search.sunbiz.org";

// ─── HTML → plain text ────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Search URL construction ──────────────────────────────────────────────────
// Sunbiz now uses a path-based results URL: /SearchResults/EntityName/{name}/Page1
// The searchNameOrder param is the name uppercased, de-punctuated, without common
// entity-type suffixes — used by Sunbiz as the initial alpha sort cursor.

function buildSearchUrl(entityName: string): string {
  const encoded = encodeURIComponent(entityName);
  // searchNameOrder must strip the entity-type suffix and all punctuation.
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

// ─── HTTP fetch ───────────────────────────────────────────────────────────────
// Uses curl instead of Node.js native fetch.
// Sunbiz is behind Cloudflare's TLS fingerprint check: Node.js (OpenSSL) gets
// a 403 challenge page, while curl (Schannel on Windows) passes through cleanly.

// cookieJar is a temp file path shared across requests in the same scrape session.
// Cloudflare sets cf_clearance on the search page; the detail page requires it.
// We never use -f: instead we inspect the body so a 4xx doesn't hard-crash us.
// --retry 2 handles transient network/timeout errors automatically.
export async function fetchSunbizHtml(
  url: string,
  cookieJar?: string,
  referer?: string,
): Promise<string> {
  const args: string[] = [
    "-s",                   // silent
    "-L",                   // follow redirects
    "--max-time", "30",     // 30 s per attempt
    "--retry", "2",         // auto-retry on connection/timeout errors (not 4xx)
    "--retry-delay", "2",
    "--compressed",         // accept gzip/brotli
    "-A",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "-H", "Accept-Language: en-US,en;q=0.5",
    "-H", "Upgrade-Insecure-Requests: 1",
    "-H", "Sec-Fetch-Dest: document",
    "-H", "Sec-Fetch-Mode: navigate",
    "-H", `Sec-Fetch-Site: ${referer ? "same-origin" : "none"}`,
  ];
  if (referer) {
    args.push("-H", `Referer: ${referer}`);
  }
  if (cookieJar) {
    args.push("-c", cookieJar, "-b", cookieJar);
  }
  args.push(url);

  // execFileAsync throws when curl exits non-zero (timeout, DNS, SSL, etc.).
  // Catch it so we can inspect any partial stdout before re-throwing.
  let stdout: string;
  try {
    const result = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
    stdout = result.stdout;
  } catch (e: unknown) {
    const err = e as { code?: number; stderr?: string; stdout?: string };
    // If curl gathered a response before failing, use it
    if (err.stdout?.trim()) {
      stdout = err.stdout;
    } else {
      const code = err.code ?? "?";
      const detail = err.stderr?.trim() || "no stderr";
      throw new Error(`curl exited ${code}: ${detail}`);
    }
  }

  const body = stdout?.trim() ?? "";
  if (!body) throw new Error(`Sunbiz returned empty response for ${url}`);
  if (body.includes("Just a moment") && body.includes("cf-")) {
    throw new Error("Sunbiz is blocking automated access (Cloudflare challenge). Try again in a moment.");
  }
  return stdout;
}

// ─── Search results parser ────────────────────────────────────────────────────
// Results are in a <table> with <tbody><tr> rows, each containing:
//   <td class="large-width">  <a href="/...SearchResultDetail?..." title="Go to Detail Screen">NAME</a>
//   <td class="medium-width"> DOCUMENT_NUMBER
//   <td class="small-width">  STATUS

export function parseSearchResults(html: string): SunbizMatch[] {
  const results: SunbizMatch[] = [];
  const rows = html.split("</tr>");

  for (const row of rows) {
    if (!row.includes("SearchResultDetail")) continue;

    // href — HTML entities decoded
    const hrefMatch = row.match(
      /href="(\/Inquiry\/CorporationSearch\/SearchResultDetail[^"]+)"/i
    );
    if (!hrefMatch) continue;
    const detailPath = hrefMatch[1].replace(/&amp;/g, "&");

    // Entity name between title="Go to Detail Screen">...</a>
    const nameMatch = row.match(/title="Go to Detail Screen">([^<]+)<\/a>/i);
    if (!nameMatch) continue;
    const entityName = nameMatch[1].trim();

    // Document number in <td class="medium-width">
    const docMatch = row.match(/<td[^>]*class="medium-width"[^>]*>\s*([^<]+?)\s*<\/td>/i);
    if (!docMatch) continue;
    const documentNumber = docMatch[1].trim();

    // Status in <td class="small-width">
    const statusMatch = row.match(/<td[^>]*class="small-width"[^>]*>\s*([^<]+?)\s*<\/td>/i);
    const status = statusMatch ? statusMatch[1].trim().toUpperCase() : "UNKNOWN";

    results.push({ entity_name: entityName, document_number: documentNumber, status, detail_path: detailPath });
  }
  return results;
}

// Pick best match: prefer ACTIVE, then closest name to the search term.
function pickBestMatch(
  matches: SunbizMatch[],
  searchTerm: string
): SunbizMatch | null {
  if (matches.length === 0) return null;

  const norm = (s: string) =>
    s.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  const target = norm(searchTerm);

  const scored = matches.map((m) => {
    let score = 0;
    if (m.status === "ACTIVE") score += 10;
    const nm = norm(m.entity_name);
    if (nm === target) score += 5;
    else if (nm.startsWith(target) || target.startsWith(nm)) score += 3;
    return { m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].m;
}

// ─── Claude extraction ────────────────────────────────────────────────────────

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_sunbiz_persons",
  description:
    "Extract all persons and addresses from a Florida Sunbiz corporation detail page. " +
    "Include the registered agent, all officers, directors, managers, members, and authorized representatives. " +
    "Only return data explicitly present in the page — never guess or invent.",
  input_schema: {
    type: "object" as const,
    required: ["entity_name", "status", "persons"],
    properties: {
      entity_name: { type: "string" },
      status: { type: "string" },
      principal_address: {
        type: ["string", "null"],
        description: "Principal/registered office address, if listed",
      },
      mailing_address: {
        type: ["string", "null"],
        description: "Separate mailing address if different from principal, else null",
      },
      persons: {
        type: "array",
        description:
          "All listed people. Set title to 'Registered Agent' for the registered agent. " +
          "Expand abbreviated titles: MGR→Manager, P→President, VP→Vice President, " +
          "T→Treasurer, S→Secretary, D→Director, AUT→Authorized Person, MGRM→Manager/Member. " +
          "Combine multi-line addresses into one string.",
        items: {
          type: "object",
          required: ["name", "title"],
          properties: {
            name: { type: "string" },
            title: { type: "string" },
            address: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};

type ExtractOutput = {
  entity_name: string;
  status: string;
  principal_address?: string | null;
  mailing_address?: string | null;
  persons: Array<{ name: string; title: string; address?: string | null }>;
};

async function claudeExtract(pageText: string): Promise<ExtractOutput> {
  const anthropic = new Anthropic();
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system:
      "You extract structured data from Florida Sunbiz corporation pages. " +
      "Return ONLY what is explicitly stated in the text — never invent or infer missing data.",
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "extract_sunbiz_persons" },
    messages: [
      {
        role: "user",
        content: `Extract all persons and addresses from this Florida Sunbiz record:\n\n${pageText}`,
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Claude did not return structured extraction from Sunbiz page.");
  }
  return block.input as ExtractOutput;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function searchAndExtractSunbiz(
  entityName: string
): Promise<SunbizLookup> {
  // Share a cookie jar so Cloudflare's cf_clearance set on the search page
  // is sent along with the detail-page request (separate curl process).
  const jar = join(tmpdir(), `sunbiz-${randomBytes(6).toString("hex")}.txt`);

  try {
  // 1. Search — directly GET-able path-based URL (discovered June 2026)
  const searchUrl = buildSearchUrl(entityName);
  const searchHtml = await fetchSunbizHtml(searchUrl, jar);
  const matches = parseSearchResults(searchHtml);
  const best = pickBestMatch(matches, entityName);

  if (!best) {
    return { result: null, matches_found: 0 };
  }

  // 2. Fetch the detail page with cookie jar + Referer so it looks like a
  //    natural browser navigation from the search results page.
  const detailUrl = best.detail_path.startsWith("http")
    ? best.detail_path
    : `${SUNBIZ_BASE}${best.detail_path}`;
  const detailHtml = await fetchSunbizHtml(detailUrl, jar, searchUrl);
  const detailText = htmlToText(detailHtml);

  // 3. Claude extracts structured persons/addresses from plain text
  const extracted = await claudeExtract(detailText);

  const persons: SunbizPerson[] = (extracted.persons ?? []).map((p) => ({
    name: p.name.trim(),
    title: p.title.trim(),
    address: p.address?.trim() || null,
  }));

  return {
    result: {
      entity_name: extracted.entity_name || best.entity_name,
      document_number: best.document_number,
      status: extracted.status || best.status,
      principal_address: extracted.principal_address?.trim() || null,
      mailing_address: extracted.mailing_address?.trim() || null,
      persons,
      source_url: detailUrl,
    },
    matches_found: matches.length,
  };
  } finally {
    unlink(jar).catch(() => {});
  }
}
