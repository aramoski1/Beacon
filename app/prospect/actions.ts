"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { searchLeads, SUPPORTED_MARKETS, type LeadSearchCriteria, type LeadSearchResult, type MarketOutcome, type SupportedMarket } from "@/lib/lead-finder";
import {
  refineLeadCriteria,
  sanitizeLeadCriteria,
  type IgnoredLeadTerm,
} from "@/lib/lead-search-interpret";
import { interpretLeadSearchWithJev } from "@/lib/jev-lead-search";
import { importTaxRollFolio } from "@/lib/mdpa-folio-ingest";
import { importBcpaFolio } from "@/lib/bcpa-folio-ingest";
import { importPbcpaFolio } from "@/lib/pbcpa-folio-ingest";
import { importMagisFolio } from "@/lib/magis-folio-ingest";
import { normalizeAddress } from "@/lib/property-ingest";
import { daysUntilExpiry } from "@/lib/lease-radar";
import { searchAndExtractSunbiz } from "@/lib/sunbiz";
import { storedOwnerContactsFromSunbiz } from "@/lib/owner-contacts";
import { runAndPersistZoning } from "@/lib/zoning-persist";

export type BuyBox = {
  id: string;
  name: string;
  criteria: LeadSearchCriteria;
  updatedAt: string;
};

export type InterpretLeadSearchResult =
  | { criteria: LeadSearchCriteria; explanation: string; ignored: IgnoredLeadTerm[] }
  | { error: string };

const INTERPRET_LEAD_TOOL: Anthropic.Tool = {
  name: "interpret_lead_search",
  description: `Map a broker's sentence into county tax-roll search criteria.

Live GIS filters that exist: markets (miami-dade, broward, palm-beach, massachusetts), cities, building SF min/max, land SF min/max, property type (residential, multifamily, retail, office, industrial, land), assessed value min/max, year built min/max, soldWithinYears, heldAtLeastYears, ownerPortfolioMin, leaseExpiringWithinDays.

Honest limits:
- Do NOT invent filters the tax roll cannot apply: docks, dock doors, clear height, ceiling height, parking, rail, power, "near the airport", drive-time, submarkets that are not city names, listing asking rent, cap rate, occupancy.
- Put every such term in ignored with a one-sentence reason. Still fill the filters that do exist (city, type, size, year, sale).
- Omit markets unless the user named a county or Massachusetts. City names are enough — a later step infers the market.
- Never default markets to all four. Empty markets is correct when the user named a city.
- Palm Beach has no building SF or year built. If the user asks for those, still set the numbers; do not add palm-beach unless they named Palm Beach or a Palm Beach city.
- Massachusetts cannot search by property type alone. If they only said "industrial in Massachusetts" with no city/size/year/sale, omit massachusetts and explain in ignored.
- "20-50k" / "20k to 50k sf" → buildingSqftMin 20000, buildingSqftMax 50000. Convert k and M.
- "held 10+ years" / "long-held" → heldAtLeastYears, not soldWithinYears. Never set both.
- "sold recently" / "just sold" → soldWithinYears 2 unless they named a number.
- "leases expiring" → leaseExpiringWithinDays (90 if they said soon). This only hits addresses already in the broker's book.
- Cities: use the spoken name (Hialeah, Ft Lauderdale). Aliases are fine.
- Omit any field that is not clearly implied.
- explanation: one sentence of what will actually be searched.`,
  input_schema: {
    type: "object" as const,
    required: ["explanation"],
    properties: {
      explanation: {
        type: "string",
        description: "One sentence describing the tax-roll search that will run.",
      },
      ignored: {
        type: "array",
        description: "Terms the tax roll cannot filter on.",
        items: {
          type: "object",
          required: ["term", "reason"],
          properties: {
            term: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      markets: {
        type: "array",
        items: {
          type: "string",
          enum: ["miami-dade", "broward", "palm-beach", "massachusetts"],
        },
        description: "Only if the user named a county or Massachusetts. Otherwise omit.",
      },
      cities: {
        type: "array",
        items: { type: "string" },
        description: "City names as spoken.",
      },
      buildingSqftMin: { type: "number" },
      buildingSqftMax: { type: "number" },
      landSqftMin: { type: "number" },
      landSqftMax: { type: "number" },
      propertyType: {
        type: "string",
        enum: ["residential", "multifamily", "retail", "office", "industrial", "land"],
      },
      assessedValueMin: { type: "number" },
      assessedValueMax: { type: "number" },
      yearBuiltMin: { type: "number" },
      yearBuiltMax: { type: "number" },
      soldWithinYears: { type: "number", description: "Last sale within this many years." },
      heldAtLeastYears: { type: "number", description: "Last sale at least this many years ago." },
      ownerPortfolioMin: { type: "number", description: "Owner holds at least this many parcels in the same market." },
      leaseExpiringWithinDays: { type: "number" },
    },
  },
};

function parseIgnored(raw: unknown): IgnoredLeadTerm[] {
  if (!Array.isArray(raw)) return [];
  const out: IgnoredLeadTerm[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ term: item.trim(), reason: "County tax rolls cannot filter on this." });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.term !== "string" || !row.term.trim()) continue;
    out.push({
      term: row.term.trim(),
      reason: typeof row.reason === "string" && row.reason.trim()
        ? row.reason.trim()
        : "County tax rolls cannot filter on this.",
    });
  }
  return out;
}

/** Maps a sentence to GIS buy-box criteria, then canonicalizes cities and honest market drops. */
export async function interpretLeadSearch(query: string): Promise<InterpretLeadSearchResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const trimmed = query.trim();
  if (!trimmed) return { error: "Enter a search." };

  const viaJev = await interpretLeadSearchWithJev(trimmed);
  if (viaJev) return viaJev;

  const anthropic = new Anthropic();
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [INTERPRET_LEAD_TOOL],
      tool_choice: { type: "tool", name: "interpret_lead_search" },
      messages: [{ role: "user", content: trimmed }],
    });
  } catch (e) {
    return { error: `Could not interpret that search: ${e instanceof Error ? e.message : String(e)}` };
  }

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { error: "Could not interpret your search. Try rephrasing." };
  }

  const input = toolBlock.input as Record<string, unknown>;
  const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
  const raw = sanitizeLeadCriteria(input);
  if (!raw) return { error: "Could not interpret your search. Try rephrasing." };

  const refined = refineLeadCriteria(raw, trimmed, parseIgnored(input.ignored));
  if (!refined.ok) return { error: refined.error };

  return {
    criteria: refined.criteria,
    explanation: explanation || "Searching county tax rolls with the filters below.",
    ignored: refined.ignored,
  };
}

// ─── Lease-expiring-soon signal (Phase 3) ─────────────────────────────────────
//
// The one Phase 3 signal that needs DB access rather than pure GIS logic —
// cross-references matches against the broker's OWN lease_abstracts (same
// table/query shape as app/lease-radar/actions.ts's getLeaseRadarData),
// matched by normalized address via lib/property-ingest.ts's
// normalizeAddress (the same normalizer every ingest path already dedupes
// with). A brand-new lead can only carry this signal once its address is
// already in the broker's book with an abstracted lease — for a genuinely
// new prospect there is nothing to cross-reference yet, so this filter
// naturally narrows toward re-run buy boxes over time, not first-time
// searches.

type LeaseByAddress = Map<string, { expirationDate: string; daysUntilExpiry: number }>;

async function fetchLeasesExpiringWithin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  withinDays: number,
): Promise<LeaseByAddress> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cutoff = new Date(now.getTime() + withinDays * 86_400_000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("lease_abstracts")
    .select("expiration_date, properties(address)")
    .eq("owner_id", userId)
    .not("expiration_date", "is", null)
    .gte("expiration_date", today)
    .lte("expiration_date", cutoff);

  const byAddress: LeaseByAddress = new Map();
  for (const row of data ?? []) {
    const address = (row as { properties?: { address?: string | null } | null }).properties?.address;
    const expirationDate = (row as { expiration_date?: string | null }).expiration_date;
    if (!address || !expirationDate) continue;
    const key = normalizeAddress(address);
    const existing = byAddress.get(key);
    const days = daysUntilExpiry(expirationDate, now);
    if (!existing || days < existing.daysUntilExpiry) {
      byAddress.set(key, { expirationDate, daysUntilExpiry: days });
    }
  }
  return byAddress;
}

function annotateAndFilterByLease(outcomes: MarketOutcome[], leases: LeaseByAddress): MarketOutcome[] {
  return outcomes.map((outcome) => {
    if (outcome.kind !== "ok") return outcome;
    const matches = outcome.matches
      .map((m) => {
        const hit = m.address ? leases.get(normalizeAddress(m.address)) : undefined;
        if (!hit) return m;
        return { ...m, leaseExpirationDate: hit.expirationDate, leaseDaysUntilExpiry: hit.daysUntilExpiry };
      })
      .filter((m) => m.leaseExpirationDate != null);
    return { ...outcome, matches };
  });
}

/** Runs a buy-box criteria search across the selected markets (see lib/lead-finder.ts). */
export async function runLeadSearch(
  rawCriteria: unknown,
): Promise<LeadSearchResult | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const criteria = sanitizeLeadCriteria(rawCriteria);
  if (!criteria) return { error: "Invalid search criteria." };
  if (criteria.markets.length === 0) return { error: "Select at least one market to search." };

  const result = await searchLeads(criteria);
  if (criteria.leaseExpiringWithinDays == null) return result;

  const leases = await fetchLeasesExpiringWithin(supabase, user.id, criteria.leaseExpiringWithinDays);
  const outcomes = annotateAndFilterByLease(result.outcomes, leases);
  const matches = outcomes.flatMap((o) => (o.kind === "ok" ? o.matches : []));
  const caveats = [
    ...result.caveats,
    "Lease-expiring-soon only flags matches whose address is already in your book with an abstracted lease — brand-new prospects won't have this signal yet.",
  ];
  return { outcomes, matches, caveats };
}

export async function listBuyBoxes(): Promise<BuyBox[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("lead_buy_boxes")
    .select("id, name, criteria, updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    criteria: row.criteria as LeadSearchCriteria,
    updatedAt: row.updated_at as string,
  }));
}

export async function saveBuyBox(
  name: string,
  rawCriteria: unknown,
): Promise<{ ok: true; id: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const trimmedName = name.trim();
  if (!trimmedName) return { error: "Give this buy box a name." };

  const criteria = sanitizeLeadCriteria(rawCriteria);
  if (!criteria) return { error: "Invalid search criteria." };

  const { data, error } = await supabase
    .from("lead_buy_boxes")
    .insert({ owner_id: user.id, name: trimmedName, criteria })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { ok: true, id: data.id as string };
}

// ─── Accept-to-enrich (Phase 2) ───────────────────────────────────────────────
//
// Reuses the SAME per-market import functions the existing owner-portfolio
// discovery flow uses (app/owner-portfolio/discovery-actions.ts) — each one
// already dedupes against the broker's book (via lib/property-ingest.ts's
// findDuplicate, matched on source_url/address) before doing the full
// property-save + county/state-detail + owner-contact pipeline. No ingestion
// logic is duplicated here; this only routes a lead to the right market's
// existing importer and tallies the honest outcome.

export type LeadToAccept = {
  market: SupportedMarket;
  folio: string;
  address: string | null;
  city: string | null;
  ownerName: string | null;
};

export type AcceptLeadsResult = {
  enrichedIds: string[];
  skippedDuplicates: number;
  failed: { market: SupportedMarket; folio: string; message: string }[];
};

function importForMarket(market: SupportedMarket, folio: string, address: string, city: string | null) {
  switch (market) {
    case "miami-dade": return importTaxRollFolio(folio, address, city);
    case "broward": return importBcpaFolio(folio, address, city);
    case "palm-beach": return importPbcpaFolio(folio, address, city);
    case "massachusetts": return importMagisFolio(folio, address, city);
  }
}

// Same heuristic used everywhere else in this codebase (app/properties/new/
// actions.ts, app/properties/[id]/actions.ts) to decide whether an owner name
// is Sunbiz-eligible (a registered entity) vs. an individual.
const ENTITY_NAME_RE = /\b(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\b/i;

/**
 * Runs the SAME post-save enrichment a manually-added property gets
 * (app/properties/new/actions.ts's saveIngestedProperty): an auto Sunbiz
 * owner lookup (Florida only — Sunbiz is Florida's Division of Corporations
 * registry, so Massachusetts is skipped exactly like every other Sunbiz call
 * site in this codebase) that overwrites the individual-owner-mailing
 * fallback contact already saved at import time, plus zoning, which applies
 * to all four markets. Unlike the single-property Enrich flow, there is no
 * per-lead broker review step here — accepting leads is a bulk action, so
 * Sunbiz's auto-picked best match is saved directly rather than staged for
 * confirmation. Both steps are best-effort: the property is already saved
 * before this runs, so a Sunbiz or zoning failure never undoes the accept.
 */
async function enrichAcceptedLead(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  propertyId: string,
  lead: LeadToAccept,
): Promise<void> {
  if (lead.market !== "massachusetts" && lead.ownerName && ENTITY_NAME_RE.test(lead.ownerName.replace(/\./g, ""))) {
    try {
      const lookup = await searchAndExtractSunbiz(lead.ownerName);
      if (lookup.result && lookup.result.persons.length > 0) {
        const owner_contacts = storedOwnerContactsFromSunbiz(lookup.result.persons);
        await supabase.from("properties").update({ owner_contacts }).eq("id", propertyId).eq("owner_id", userId);
      }
    } catch {
      // Best-effort — the property is already saved; Sunbiz can be re-run later from the property page.
    }
  }

  try {
    await runAndPersistZoning(supabase, userId, propertyId, {
      county: lead.market,
      address: lead.address ?? "",
      city: lead.city,
      strap: lead.folio,
    });
  } catch {
    // Best-effort — non-fatal, same as every other zoning call site.
  }
}

/** Accepts one or more lead-finder matches into the broker's book, individually or in bulk. */
export async function acceptLeads(leads: LeadToAccept[]): Promise<AcceptLeadsResult> {
  const enrichedIds: string[] = [];
  let skippedDuplicates = 0;
  const failed: { market: SupportedMarket; folio: string; message: string }[] = [];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      enrichedIds: [],
      skippedDuplicates: 0,
      failed: leads.map((l) => ({ market: l.market, folio: l.folio, message: "Not authenticated." })),
    };
  }

  for (const lead of leads) {
    if (!(SUPPORTED_MARKETS as string[]).includes(lead.market)) {
      failed.push({ market: lead.market, folio: lead.folio, message: "Unknown market." });
      continue;
    }
    const address = lead.address?.trim();
    if (!address) {
      failed.push({ market: lead.market, folio: lead.folio, message: "No address on this record." });
      continue;
    }
    try {
      const res = await importForMarket(lead.market, lead.folio, address, lead.city);
      if ("id" in res) {
        enrichedIds.push(res.id);
        await enrichAcceptedLead(supabase, user.id, res.id, lead);
      } else if (res.existingId) {
        skippedDuplicates += 1;
      } else {
        failed.push({ market: lead.market, folio: lead.folio, message: res.error });
      }
    } catch (e) {
      failed.push({ market: lead.market, folio: lead.folio, message: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  return { enrichedIds, skippedDuplicates, failed };
}

export async function deleteBuyBox(id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("lead_buy_boxes")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) return { error: error.message };
  return { ok: true };
}
