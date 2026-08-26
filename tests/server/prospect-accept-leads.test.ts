/**
 * acceptLeads (app/prospect/actions.ts) — Phase 2 of the lead finder.
 *
 * acceptLeads doesn't implement its own dedup/ingest logic; it routes each
 * accepted lead to the SAME per-market import function the existing
 * owner-portfolio discovery flow already uses (app/owner-portfolio/
 * discovery-actions.ts), which itself dedupes against the broker's book via
 * lib/property-ingest.ts's findDuplicate. These tests cover acceptLeads' own
 * routing/aggregation responsibility: picking the right importer per market,
 * turning {id}/{existingId}/{error} into an honest
 * enrichedIds/skippedDuplicates/failed summary, and the post-import
 * enrichment step (Sunbiz owner lookup + zoning) it runs on every newly
 * created property — the same enrichment a manually-added property gets
 * (app/properties/new/actions.ts's saveIngestedProperty), just without a
 * per-lead broker review step since accepting is a bulk action.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/mdpa-folio-ingest", () => ({ importTaxRollFolio: vi.fn() }));
vi.mock("@/lib/bcpa-folio-ingest", () => ({ importBcpaFolio: vi.fn() }));
vi.mock("@/lib/pbcpa-folio-ingest", () => ({ importPbcpaFolio: vi.fn() }));
vi.mock("@/lib/magis-folio-ingest", () => ({ importMagisFolio: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/sunbiz", () => ({ searchAndExtractSunbiz: vi.fn() }));
vi.mock("@/lib/zoning-persist", () => ({ runAndPersistZoning: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { importTaxRollFolio } from "@/lib/mdpa-folio-ingest";
import { importBcpaFolio } from "@/lib/bcpa-folio-ingest";
import { importPbcpaFolio } from "@/lib/pbcpa-folio-ingest";
import { importMagisFolio } from "@/lib/magis-folio-ingest";
import { searchAndExtractSunbiz } from "@/lib/sunbiz";
import { runAndPersistZoning } from "@/lib/zoning-persist";
import { acceptLeads, type LeadToAccept } from "@/app/prospect/actions";

function lead(overrides: Partial<LeadToAccept> = {}): LeadToAccept {
  return {
    market: "miami-dade",
    folio: "0101010001010",
    address: "601 NW 11 ST",
    city: "Miami",
    ownerName: "SOME OWNER",
    ...overrides,
  };
}

function fakeSupabase() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })),
    })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (createClient as Mock).mockResolvedValue(fakeSupabase());
  (runAndPersistZoning as Mock).mockResolvedValue({ kind: "ok" });
  (searchAndExtractSunbiz as Mock).mockResolvedValue({ result: null, matches_found: 0 });
});

describe("acceptLeads", () => {
  it("routes a Miami-Dade lead to importTaxRollFolio with the folio/address/city", async () => {
    vi.mocked(importTaxRollFolio).mockResolvedValue({ id: "prop-1" });
    const result = await acceptLeads([lead()]);
    expect(importTaxRollFolio).toHaveBeenCalledWith("0101010001010", "601 NW 11 ST", "Miami");
    expect(result.enrichedIds).toEqual(["prop-1"]);
  });

  it("routes each market to its own importer", async () => {
    vi.mocked(importTaxRollFolio).mockResolvedValue({ id: "md-1" });
    vi.mocked(importBcpaFolio).mockResolvedValue({ id: "bc-1" });
    vi.mocked(importPbcpaFolio).mockResolvedValue({ id: "pb-1" });
    vi.mocked(importMagisFolio).mockResolvedValue({ id: "ma-1" });

    const result = await acceptLeads([
      lead({ market: "miami-dade", folio: "F1" }),
      lead({ market: "broward", folio: "F2" }),
      lead({ market: "palm-beach", folio: "F3" }),
      lead({ market: "massachusetts", folio: "F4" }),
    ]);

    expect(importTaxRollFolio).toHaveBeenCalledTimes(1);
    expect(importBcpaFolio).toHaveBeenCalledTimes(1);
    expect(importPbcpaFolio).toHaveBeenCalledTimes(1);
    expect(importMagisFolio).toHaveBeenCalledTimes(1);
    expect(result.enrichedIds.sort()).toEqual(["bc-1", "ma-1", "md-1", "pb-1"]);
  });

  it("counts a lead already in the broker's book as a skipped duplicate, not a failure", async () => {
    vi.mocked(importTaxRollFolio).mockResolvedValue({ error: "Already in your workspace.", existingId: "prop-existing" });
    const result = await acceptLeads([lead()]);
    expect(result.enrichedIds).toEqual([]);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.failed).toEqual([]);
  });

  it("reports a real ingest error as failed, not as a skipped duplicate", async () => {
    vi.mocked(importTaxRollFolio).mockResolvedValue({ error: "Miami-Dade detail fetch failed: HTTP 500" });
    const result = await acceptLeads([lead()]);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.failed).toEqual([
      { market: "miami-dade", folio: "0101010001010", message: "Miami-Dade detail fetch failed: HTTP 500" },
    ]);
  });

  it("catches a thrown exception from the importer as a failure instead of rejecting the whole batch", async () => {
    vi.mocked(importTaxRollFolio).mockRejectedValue(new Error("network down"));
    const result = await acceptLeads([lead()]);
    expect(result.failed).toEqual([{ market: "miami-dade", folio: "0101010001010", message: "network down" }]);
  });

  it("fails a lead with no address without calling any importer", async () => {
    const result = await acceptLeads([lead({ address: null })]);
    expect(importTaxRollFolio).not.toHaveBeenCalled();
    expect(result.failed).toEqual([{ market: "miami-dade", folio: "0101010001010", message: "No address on this record." }]);
  });

  it("fails a lead with an unrecognized market without calling any importer", async () => {
    // @ts-expect-error deliberately invalid market to exercise the runtime guard
    const result = await acceptLeads([lead({ market: "texas" })]);
    expect(importTaxRollFolio).not.toHaveBeenCalled();
    expect(importBcpaFolio).not.toHaveBeenCalled();
    expect(result.failed).toEqual([{ market: "texas", folio: "0101010001010", message: "Unknown market." }]);
  });

  it("processes a mixed bulk batch and tallies enriched/skipped/failed independently", async () => {
    vi.mocked(importTaxRollFolio)
      .mockResolvedValueOnce({ id: "prop-a" })
      .mockResolvedValueOnce({ error: "Already in your workspace.", existingId: "prop-b" });
    vi.mocked(importBcpaFolio).mockResolvedValue({ error: "Broward detail fetch failed: HTTP 503" });

    const result = await acceptLeads([
      lead({ folio: "A" }),
      lead({ folio: "B" }),
      lead({ market: "broward", folio: "C" }),
    ]);

    expect(result.enrichedIds).toEqual(["prop-a"]);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.failed).toEqual([{ market: "broward", folio: "C", message: "Broward detail fetch failed: HTTP 503" }]);
  });

  it("fails every lead with 'Not authenticated.' without calling any importer when there is no user", async () => {
    (createClient as Mock).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } });
    const result = await acceptLeads([lead({ folio: "A" }), lead({ market: "broward", folio: "B" })]);
    expect(importTaxRollFolio).not.toHaveBeenCalled();
    expect(importBcpaFolio).not.toHaveBeenCalled();
    expect(result.failed).toEqual([
      { market: "miami-dade", folio: "A", message: "Not authenticated." },
      { market: "broward", folio: "B", message: "Not authenticated." },
    ]);
  });

  describe("post-import enrichment (Sunbiz + zoning)", () => {
    it("runs zoning for every newly created property, regardless of market", async () => {
      vi.mocked(importTaxRollFolio).mockResolvedValue({ id: "prop-1" });
      await acceptLeads([lead({ ownerName: "JANE DOE" })]);
      expect(runAndPersistZoning).toHaveBeenCalledTimes(1);
      expect(runAndPersistZoning).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        "prop-1",
        { county: "miami-dade", address: "601 NW 11 ST", city: "Miami", strap: "0101010001010" },
      );
    });

    it("runs a Sunbiz lookup only when the owner name looks like a registered entity", async () => {
      vi.mocked(importTaxRollFolio).mockResolvedValue({ id: "prop-1" });
      await acceptLeads([lead({ ownerName: "CRISTEC LLC" })]);
      expect(searchAndExtractSunbiz).toHaveBeenCalledWith("CRISTEC LLC");
    });

    it("skips the Sunbiz lookup for an individual owner name", async () => {
      vi.mocked(importTaxRollFolio).mockResolvedValue({ id: "prop-1" });
      await acceptLeads([lead({ ownerName: "JANE DOE" })]);
      expect(searchAndExtractSunbiz).not.toHaveBeenCalled();
    });

    it("never runs a Sunbiz lookup for Massachusetts, even for an entity-looking owner", async () => {
      vi.mocked(importMagisFolio).mockResolvedValue({ id: "prop-1" });
      await acceptLeads([lead({ market: "massachusetts", ownerName: "ACME LLC" })]);
      expect(searchAndExtractSunbiz).not.toHaveBeenCalled();
      expect(runAndPersistZoning).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        "prop-1",
        { county: "massachusetts", address: "601 NW 11 ST", city: "Miami", strap: "0101010001010" },
      );
    });

    it("overwrites owner_contacts with the Sunbiz result when a match is found", async () => {
      vi.mocked(importTaxRollFolio).mockResolvedValue({ id: "prop-1" });
      const eq2 = vi.fn(() => Promise.resolve({ error: null }));
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      const update = vi.fn((_payload: { owner_contacts: { name: string }[] }) => ({ eq: eq1 }));
      (createClient as Mock).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
        from: vi.fn(() => ({ update })),
      });
      (searchAndExtractSunbiz as Mock).mockResolvedValue({
        result: {
          entity_name: "CRISTEC LLC",
          document_number: "L123456",
          status: "Active",
          principal_address: null,
          mailing_address: null,
          persons: [{ name: "JOHN SMITH", title: "President", address: null }],
          source_url: "https://search.sunbiz.org/...",
        },
        matches_found: 1,
      });

      await acceptLeads([lead({ ownerName: "CRISTEC LLC" })]);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0][0].owner_contacts.some((c) => c.name === "JOHN SMITH")).toBe(true);
    });

    it("does not fail the accept when Sunbiz throws", async () => {
      vi.mocked(importTaxRollFolio).mockResolvedValue({ id: "prop-1" });
      (searchAndExtractSunbiz as Mock).mockRejectedValue(new Error("Sunbiz down"));
      const result = await acceptLeads([lead({ ownerName: "CRISTEC LLC" })]);
      expect(result.enrichedIds).toEqual(["prop-1"]);
      expect(result.failed).toEqual([]);
    });

    it("does not fail the accept when zoning throws", async () => {
      vi.mocked(importTaxRollFolio).mockResolvedValue({ id: "prop-1" });
      (runAndPersistZoning as Mock).mockRejectedValue(new Error("zoning down"));
      const result = await acceptLeads([lead()]);
      expect(result.enrichedIds).toEqual(["prop-1"]);
      expect(result.failed).toEqual([]);
    });

    it("does not enrich a skipped duplicate", async () => {
      vi.mocked(importTaxRollFolio).mockResolvedValue({ error: "Already in your workspace.", existingId: "prop-existing" });
      await acceptLeads([lead({ ownerName: "CRISTEC LLC" })]);
      expect(searchAndExtractSunbiz).not.toHaveBeenCalled();
      expect(runAndPersistZoning).not.toHaveBeenCalled();
    });
  });
});
