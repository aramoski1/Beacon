/**
 * runLeadSearch's lease-expiring-soon signal (app/prospect/actions.ts,
 * Phase 3 of the lead finder). This is the one Phase 3 signal that needs DB
 * access — it cross-references matches against the broker's own
 * lease_abstracts (same table/shape app/lease-radar/actions.ts already
 * queries), matched by lib/property-ingest.ts's normalizeAddress. Since
 * lib/lead-finder.ts's searchLeads has no DB access, these tests mock it
 * directly and verify the annotate+filter step actions.ts layers on top.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/lead-finder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lead-finder")>();
  return { ...actual, searchLeads: vi.fn() };
});

import { createClient } from "@/lib/supabase/server";
import { searchLeads } from "@/lib/lead-finder";
import { runLeadSearch } from "@/app/prospect/actions";

function match(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    market: "miami-dade",
    source: "Miami-Dade Property Appraiser (MDC.PaGis)",
    folio: "F1",
    strap: "F1",
    address: "123 MAIN ST",
    city: "Miami",
    ownerName: "TEST OWNER",
    buildingSqft: 10000,
    landSqft: 20000,
    useCode: null,
    useDescription: null,
    assessedValue: 500000,
    yearBuilt: 1990,
    lastSaleDate: null,
    ownerPortfolioCount: null,
    leaseExpirationDate: null,
    leaseDaysUntilExpiry: null,
    ...overrides,
  };
}

function fakeSupabase(leaseRows: { expiration_date: string; properties: { address: string } | null }[]) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          not: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn(() => Promise.resolve({ data: leaseRows })),
            })),
          })),
        })),
      })),
    })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runLeadSearch — lease-expiring-soon signal", () => {
  it("does not query lease_abstracts at all when leaseExpiringWithinDays is not set", async () => {
    const supabase = fakeSupabase([]);
    (createClient as Mock).mockResolvedValue(supabase);
    (searchLeads as Mock).mockResolvedValue({
      outcomes: [{ market: "miami-dade", kind: "ok", matches: [match()], totalCount: 1 }],
      matches: [match()],
      caveats: [],
    });

    const result = await runLeadSearch({ markets: ["miami-dade"] });
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(result.matches).toHaveLength(1);
  });

  it("flags and keeps a match whose address has an expiring lease in the broker's book", async () => {
    const supabase = fakeSupabase([
      { expiration_date: "2026-09-01", properties: { address: "123 Main St" } },
    ]);
    (createClient as Mock).mockResolvedValue(supabase);
    (searchLeads as Mock).mockResolvedValue({
      outcomes: [{ market: "miami-dade", kind: "ok", matches: [match({ address: "123 MAIN ST" })], totalCount: 1 }],
      matches: [match({ address: "123 MAIN ST" })],
      caveats: [],
    });

    const result = await runLeadSearch({ markets: ["miami-dade"], leaseExpiringWithinDays: 180 });
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].leaseExpirationDate).toBe("2026-09-01");
    expect(result.matches[0].leaseDaysUntilExpiry).not.toBeNull();
    expect(result.caveats.some((c) => c.includes("already in your book"))).toBe(true);
  });

  it("drops a match with no matching lease when the signal is requested", async () => {
    const supabase = fakeSupabase([]);
    (createClient as Mock).mockResolvedValue(supabase);
    (searchLeads as Mock).mockResolvedValue({
      outcomes: [{ market: "miami-dade", kind: "ok", matches: [match()], totalCount: 1 }],
      matches: [match()],
      caveats: [],
    });

    const result = await runLeadSearch({ markets: ["miami-dade"], leaseExpiringWithinDays: 90 });
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.matches).toHaveLength(0);
  });

  it("matches leases by normalized address (case/suite differences don't block a match)", async () => {
    const supabase = fakeSupabase([
      { expiration_date: "2026-12-01", properties: { address: "123 main st Suite 400" } },
    ]);
    (createClient as Mock).mockResolvedValue(supabase);
    (searchLeads as Mock).mockResolvedValue({
      outcomes: [{ market: "miami-dade", kind: "ok", matches: [match({ address: "123 MAIN ST" })], totalCount: 1 }],
      matches: [match({ address: "123 MAIN ST" })],
      caveats: [],
    });

    const result = await runLeadSearch({ markets: ["miami-dade"], leaseExpiringWithinDays: 365 });
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.matches).toHaveLength(1);
  });

  it("leaves a per-market too_many/error outcome untouched", async () => {
    const supabase = fakeSupabase([]);
    (createClient as Mock).mockResolvedValue(supabase);
    (searchLeads as Mock).mockResolvedValue({
      outcomes: [{ market: "broward", kind: "too_many", count: 500 }],
      matches: [],
      caveats: [],
    });

    const result = await runLeadSearch({ markets: ["broward"], leaseExpiringWithinDays: 90 });
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.outcomes).toEqual([{ market: "broward", kind: "too_many", count: 500 }]);
  });
});
