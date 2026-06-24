"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

// ─── Filter shapes ────────────────────────────────────────────────────────────
// These are the ONLY operations Claude is allowed to express.
// Each field maps 1:1 to a safe JS filter predicate — no raw SQL ever built.

export type PropertySearchFilters = {
  property_type?: string;         // exact enum match
  ownership_type?: string;        // exact enum match
  size_sqft_min?: number;
  size_sqft_max?: number;
  last_sale_price_min?: number;
  last_sale_price_max?: number;
  geographic_keyword?: string;    // case-insensitive substring on address + city + geographic_category
  owner_name_contains?: string;
  size_category_keyword?: string;
};

export type ContactSearchFilters = {
  contact_tier?: number;          // 1, 2, or 3
  client_status?: string;         // exact enum match
  action_tags_includes?: string;  // array includes
  not_contacted_in_days?: number; // last_contacted_at < now-N days OR is null
  last_contacted_within_days?: number;
  geographic_keyword?: string;
  size_category_keyword?: string;
  ownership_type_keyword?: string;
  name_contains?: string;
  company_contains?: string;
};

export type LeaseSearchFilters = {
  status?: "active" | "expiring" | "expired"; // derived from expiration_date vs now
  expiring_within_days?: number;              // expiration_date within N days from today
  base_rate_min?: number;
  base_rate_max?: number;
};

export type SearchResult = {
  target: "properties" | "contacts" | "leases" | "both";
  properties?: PropertySearchFilters;
  contacts?: ContactSearchFilters;
  leases?: LeaseSearchFilters;
  explanation: string;
};

export type SearchResponse = SearchResult | { error: string };

// ─── Tool definition ──────────────────────────────────────────────────────────

const INTERPRET_TOOL: Anthropic.Tool = {
  name: "interpret_crm_search",
  description: `Interpret a natural-language search query for a real estate broker's CRM.

The CRM has three tables:

PROPERTIES — commercial real estate records:
  property_type: industrial | office | retail | multifamily | land | residential | mixed-use | other
  ownership_type: institutional | private | REIT | owner-occupant | unknown
  size_sqft: building square footage (number)
  last_sale_price: most recent sale price in dollars
  owner_name: text name of the owner
  geographic_category: broker's custom area label (e.g. "Brickell", "Airport West")
  size_category: broker's custom size label (e.g. "Large", ">100k sf")
  address, city: location fields

CONTACTS — people the broker manages:
  contact_tier: 1 (highest priority), 2 (medium), 3 (lower)
  client_status: prospect | active client | past client
  action_tags: array of custom string tags
  last_contacted_at: timestamp of most recent contact (null = never contacted)
  geographic_category, size_category, ownership_type: broker's categorization of the contact
  name, company: identity fields

LEASE_ABSTRACTS — abstracted lease documents:
  execution_date: when the lease was signed
  expiration_date: when the lease expires
  term: text description (e.g. "5 years")
  base_rate: annual rent per sqft in dollars
  Derived statuses: active = expiration > 90 days away; expiring = expiration within 90 days; expired = expiration in the past

Rules for interpretation:
- "owners" without qualifier → don't set ownership_type unless the type is clearly stated (e.g. "private owners" → ownership_type: private)
- "haven't contacted in X days" / "not reached in X days" → not_contacted_in_days: X (includes never-contacted)
- "recently contacted" / "contacted in the last X days" → last_contacted_within_days: X
- "near [place]" / "[place] area" → geographic_keyword: place name
- "tier 1/2/3" → contact_tier: 1/2/3
- "prospects" → client_status: prospect
- "over X sqft" → size_sqft_min: X; "under X sqft" → size_sqft_max: X
- "over $X" / "more than $X million" → last_sale_price_min: X (convert M to full dollars)
- "expiring leases" / "leases expiring soon" → target: leases, leases.status: expiring
- "expired leases" → target: leases, leases.status: expired
- "active leases" → target: leases, leases.status: active
- "leases expiring in X days" → target: leases, leases.expiring_within_days: X
- "leases over $X/sqft" → target: leases, leases.base_rate_min: X
- Only set target: "both" when the query meaningfully spans multiple tables
- Set target: "leases" when the query is about lease documents or expiration dates
- Set target: "properties" when primarily about real estate records
- Set target: "contacts" when primarily about people
- Omit any filter that is not clearly implied — prefer fewer, more precise filters`,

  input_schema: {
    type: "object" as const,
    required: ["target", "explanation"],
    properties: {
      target: {
        type: "string",
        enum: ["properties", "contacts", "leases", "both"],
        description: "Which table(s) the search primarily targets.",
      },
      properties: {
        type: "object",
        description: "Filters for the properties table. Omit entirely if target is 'contacts'.",
        properties: {
          property_type: {
            type: "string",
            enum: ["industrial", "office", "retail", "multifamily", "land", "residential", "mixed-use", "other"],
          },
          ownership_type: {
            type: "string",
            enum: ["institutional", "private", "REIT", "owner-occupant", "unknown"],
          },
          size_sqft_min: { type: "number", description: "Minimum building sqft (inclusive)." },
          size_sqft_max: { type: "number", description: "Maximum building sqft (inclusive)." },
          last_sale_price_min: { type: "number", description: "Minimum last sale price in dollars." },
          last_sale_price_max: { type: "number", description: "Maximum last sale price in dollars." },
          geographic_keyword: {
            type: "string",
            description: "Substring matched (case-insensitive) against address, city, and geographic_category.",
          },
          owner_name_contains: { type: "string", description: "Substring matched against owner_name." },
          size_category_keyword: { type: "string", description: "Substring matched against size_category." },
        },
      },
      contacts: {
        type: "object",
        description: "Filters for the contacts table. Omit entirely if target is 'properties' or 'leases'.",
        properties: {
          contact_tier: { type: "number", enum: [1, 2, 3] },
          client_status: {
            type: "string",
            enum: ["prospect", "active client", "past client"],
          },
          action_tags_includes: { type: "string", description: "Contact must have this tag in action_tags." },
          not_contacted_in_days: {
            type: "number",
            description: "Contact's last_contacted_at is null OR older than N days ago.",
          },
          last_contacted_within_days: {
            type: "number",
            description: "Contact's last_contacted_at is within the last N days.",
          },
          geographic_keyword: { type: "string", description: "Substring matched against geographic_category." },
          size_category_keyword: { type: "string", description: "Substring matched against size_category." },
          ownership_type_keyword: { type: "string", description: "Substring matched against ownership_type." },
          name_contains: { type: "string", description: "Substring matched against name." },
          company_contains: { type: "string", description: "Substring matched against company." },
        },
      },
      leases: {
        type: "object",
        description: "Filters for the lease_abstracts table. Omit entirely if target is 'properties' or 'contacts'.",
        properties: {
          status: {
            type: "string",
            enum: ["active", "expiring", "expired"],
            description: "active = expiration > 90 days away; expiring = within 90 days; expired = past.",
          },
          expiring_within_days: {
            type: "number",
            description: "Leases whose expiration_date falls within N days from today.",
          },
          base_rate_min: { type: "number", description: "Minimum base rate in $/sqft/year." },
          base_rate_max: { type: "number", description: "Maximum base rate in $/sqft/year." },
        },
      },
      explanation: {
        type: "string",
        description: "One sentence describing the search in broker-friendly terms, e.g. 'Industrial properties over 100k sqft near the airport where the owner hasn't been contacted in 90 days.'",
      },
    },
  },
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteProperty(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  // owner_id filter is defense-in-depth; RLS already enforces this at the DB level
  const { error } = await supabase
    .from("properties")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };
  return {};
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function interpretSearch(query: string): Promise<SearchResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (!query.trim()) return { error: "Enter a search query." };

  const anthropic = new Anthropic();
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [INTERPRET_TOOL],
      tool_choice: { type: "tool", name: "interpret_crm_search" },
      messages: [{ role: "user", content: query }],
    });
  } catch (e) {
    return { error: `AI search failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { error: "Could not interpret your search. Try rephrasing." };
  }

  return toolBlock.input as SearchResult;
}
