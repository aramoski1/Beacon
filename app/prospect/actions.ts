"use server";

import { createClient } from "@/lib/supabase/server";
import { searchLeads, SUPPORTED_MARKETS, type LeadSearchCriteria, type LeadSearchResult, type MarketOutcome, type SupportedMarket } from "@/lib/lead-finder";
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

function sanitizeCriteria(input: unknown): LeadSearchCriteria | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;

  const markets = Array.isArray(c.markets)
    ? c.markets.filter((m): m is LeadSearchCriteria["markets"][number] =>
        typeof m === "string" && (SUPPORTED_MARKETS as string[]).includes(m),
      )
    : [];

  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const propertyType = c.propertyType;
  const validTypes = ["residential", "multifamily", "retail", "office", "industrial", "land"];

  return {
    markets,
    cities: Array.isArray(c.cities) ? c.cities.filter((x): x is string => typeof x === "string") : undefined,
    buildingSqftMin: num(c.buildingSqftMin),
    buildingSqftMax: num(c.buildingSqftMax),
    landSqftMin: num(c.landSqftMin),
    landSqftMax: num(c.landSqftMax),
    propertyType: typeof propertyType === "string" && validTypes.includes(propertyType)
      ? (propertyType as LeadSearchCriteria["propertyType"])
      : undefined,
    assessedValueMin: num(c.assessedValueMin),
    assessedValueMax: num(c.assessedValueMax),
    yearBuiltMin: num(c.yearBuiltMin),
    yearBuiltMax: num(c.yearBuiltMax),
    soldWithinYears: num(c.soldWithinYears),
    heldAtLeastYears: num(c.heldAtLeastYears),
    ownerPortfolioMin: num(c.ownerPortfolioMin),
    leaseExpiringWithinDays: num(c.leaseExpiringWithinDays),
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

  const criteria = sanitizeCriteria(rawCriteria);
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

  const criteria = sanitizeCriteria(rawCriteria);
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
