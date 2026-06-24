// Florida Division of Corporations public records scraper.
// search.sunbiz.org has no API — this scrapes the public HTML search.
// Two-step: search by entity name → fetch detail page → Claude extracts persons.

import Anthropic from "@anthropic-ai/sdk";

const SUNBIZ_BASE = "https://search.sunbiz.org";

// Polite user-agent for a public government website
const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

// ─── HTML → plain text ────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SunbizMatch {
  entity_name: string;
  document_number: string;
  status: string;
  detail_path: string;
}

export interface SunbizPerson {
  name: string;
  title: string;
  address: string | null;
}

export interface SunbizResult {
  entity_name: string;
  document_number: string;
  status: string;
  principal_address: string | null;
  mailing_address: string | null;
  persons: SunbizPerson[]; // all listed people incl. registered agent
  source_url: string;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

export async function fetchSunbizHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Sunbiz returned HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
}

// ─── Search results parser ────────────────────────────────────────────────────
// Splits by </tr> and looks for GetCorpDetails hrefs in each row.

export function parseSearchResults(html: string): SunbizMatch[] {
  const results: SunbizMatch[] = [];
  const rows = html.split("</tr>");

  for (const row of rows) {
    if (!row.includes("GetCorpDetails")) continue;

    // Extract document number from the href — appears as ?id=XXXXX or &id=XXXXX
    const idMatch = row.match(/[?&](?:amp;)?id=([A-Z0-9]+)/i);
    if (!idMatch) continue;
    const documentNumber = idMatch[1].trim();
    if (!documentNumber) continue;

    // Entity name is the link text inside the GetCorpDetails anchor
    const nameMatch = row.match(/GetCorpDetails[^>]*>([^<]+)<\/a>/i);
    if (!nameMatch) continue;
    const entityName = nameMatch[1].trim();
    if (!entityName) continue;

    // Status appears as a bare word in the row cells
    const statusMatch = row.match(
      /\b(ACTIVE|INACTIVE|DISSOLVED|REVOKED|ADMIN DISSOLVED|ADMIN REVOKED)\b/i
    );
    const status = statusMatch ? statusMatch[1].toUpperCase() : "UNKNOWN";

    results.push({
      entity_name: entityName,
      document_number: documentNumber,
      status,
      detail_path: `/Inquiry/CorporationSearch/GetCorpDetails?id=${documentNumber}`,
    });
  }

  return results;
}

// Pick the best match: prefer ACTIVE, then closest name to search term.
function pickBestMatch(
  matches: SunbizMatch[],
  searchTerm: string
): SunbizMatch | null {
  if (matches.length === 0) return null;

  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,]/g, "")
      .replace(/\s+/g, " ")
      .trim();
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
        description: "Principal/registered office address of the entity, if listed",
      },
      mailing_address: {
        type: ["string", "null"],
        description: "Separate mailing address if different from principal, else null",
      },
      persons: {
        type: "array",
        description:
          "All listed people: set title to 'Registered Agent' for the registered agent, " +
          "expand abbreviated Sunbiz titles (MGR→Manager, P→President, VP→Vice President, " +
          "T→Treasurer, S→Secretary, D→Director, AUT→Authorized Person, MGRM→Manager/Member). " +
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

export interface SunbizLookup {
  result: SunbizResult | null;   // null = no match found
  matches_found: number;          // total results from search page
}

export async function searchAndExtractSunbiz(
  entityName: string
): Promise<SunbizLookup> {
  // 1. Search by entity name
  const searchUrl =
    `${SUNBIZ_BASE}/Inquiry/CorporationSearch/SearchResults` +
    `?inquiryType=EntityName` +
    `&inquiryDirectionType=ForwardList` +
    `&searchNameOrder=` +
    `&masterDataToType=` +
    `&searchTerm=${encodeURIComponent(entityName)}` +
    `&listNameOrder=`;

  const searchHtml = await fetchSunbizHtml(searchUrl);
  const matches = parseSearchResults(searchHtml);
  const best = pickBestMatch(matches, entityName);

  if (!best) {
    return { result: null, matches_found: 0 };
  }

  // 2. Fetch the detail page
  const detailUrl = `${SUNBIZ_BASE}${best.detail_path}`;
  const detailHtml = await fetchSunbizHtml(detailUrl);
  const detailText = htmlToText(detailHtml);

  // 3. Claude extracts structured persons/addresses from the plain text
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
}
