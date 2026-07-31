/**
 * Regression coverage for ingestAddress's error-message branching
 * (app/properties/new/actions.ts).
 *
 * When detectCounty can't route an address's city to a supported county AND
 * every county search (Miami-Dade, Broward, Palm Beach) genuinely returns
 * nothing (no error, no too-many-candidates), the error must say the address
 * is outside coverage — not "no parcel found", which wrongly implies the
 * property itself doesn't exist (e.g. an Orlando/Orange County address isn't
 * built). A genuine miss inside a *known, supported* county still says "no
 * parcel found".
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

vi.mock("@/lib/county-router", () => ({
  detectCounty: vi.fn(),
  parseCityFromAddress: vi.fn(),
  searchParcelsByAddress: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { detectCounty, parseCityFromAddress, searchParcelsByAddress } from "@/lib/county-router";
import { ingestAddress } from "@/app/properties/new/actions";

function formDataWithAddress(address: string): FormData {
  const fd = new FormData();
  fd.set("address", address);
  return fd;
}

function fakeSupabase() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: vi.fn(() => ({
      insert: () => Promise.resolve({ error: null }),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (createClient as Mock).mockResolvedValue(fakeSupabase());
});

describe("ingestAddress — coverage vs. genuine-miss error messages", () => {
  it("says the address is outside coverage when the city can't be routed and every county comes back empty (Orlando example)", async () => {
    // "500 N Orange Ave" has no city suffix, so parseCityFromAddress returns
    // undefined and detectCounty is never given anything to match.
    (parseCityFromAddress as Mock).mockReturnValue(undefined);
    (detectCounty as Mock).mockReturnValue(null);
    (searchParcelsByAddress as Mock).mockResolvedValue({ kind: "ok", parcels: [] });

    const result = await ingestAddress(formDataWithAddress("500 N Orange Ave"));

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside our current coverage");
      expect(result.error).toContain("Miami-Dade, Broward, and Palm Beach only");
      expect(result.error).not.toContain("No parcel found");
    }
    expect(searchParcelsByAddress).toHaveBeenCalledWith("500 N Orange Ave", "miami-dade");
    expect(searchParcelsByAddress).toHaveBeenCalledWith("500 N Orange Ave", "broward");
    expect(searchParcelsByAddress).toHaveBeenCalledWith("500 N Orange Ave", "palm-beach");
  });

  it("says 'No parcel found' (not a coverage message) for a genuine miss in a known, supported Palm Beach city", async () => {
    (parseCityFromAddress as Mock).mockReturnValue("Boca Raton");
    (detectCounty as Mock).mockReturnValue("palm-beach");
    (searchParcelsByAddress as Mock).mockResolvedValue({ kind: "ok", parcels: [] });

    const result = await ingestAddress(formDataWithAddress("9999 Nonexistent Rd, Boca Raton"));

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("No parcel found");
      expect(result.error).not.toContain("outside our current coverage");
    }
    expect(searchParcelsByAddress).toHaveBeenCalledTimes(1);
    expect(searchParcelsByAddress).toHaveBeenCalledWith("9999 Nonexistent Rd, Boca Raton", "palm-beach");
  });

  it("says 'No parcel found' (not a coverage message) for a genuine miss in a known, supported county", async () => {
    (parseCityFromAddress as Mock).mockReturnValue("Hollywood");
    (detectCounty as Mock).mockReturnValue("broward");
    (searchParcelsByAddress as Mock).mockResolvedValue({ kind: "ok", parcels: [] });

    const result = await ingestAddress(formDataWithAddress("9999 Nonexistent St, Hollywood"));

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("No parcel found");
      expect(result.error).not.toContain("outside our current coverage");
    }
    // Only the known county is searched — no need to also try the other.
    expect(searchParcelsByAddress).toHaveBeenCalledTimes(1);
    expect(searchParcelsByAddress).toHaveBeenCalledWith("9999 Nonexistent St, Hollywood", "broward");
  });

  it("still returns matches normally when a known county finds a parcel", async () => {
    (parseCityFromAddress as Mock).mockReturnValue("Hollywood");
    (detectCounty as Mock).mockReturnValue("broward");
    (searchParcelsByAddress as Mock).mockResolvedValue({
      kind: "ok",
      parcels: [{ folio: "514209051449", strap: "51-4209-05-1449", address: "2116 SHERMAN ST", county: "broward" }],
    });

    const result = await ingestAddress(formDataWithAddress("2116 Sherman St, Hollywood"));

    expect("error" in result).toBe(false);
    if (!("error" in result) && "matches" in result) {
      expect(result.matches).toHaveLength(1);
    }
  });

  it("does not claim outside coverage when a real service error occurred (surfaces the error instead)", async () => {
    (parseCityFromAddress as Mock).mockReturnValue(undefined);
    (detectCounty as Mock).mockReturnValue(null);
    (searchParcelsByAddress as Mock)
      .mockResolvedValueOnce({ kind: "error", message: "HTTP 503" }) // miami-dade
      .mockResolvedValueOnce({ kind: "ok", parcels: [] }) // broward
      .mockResolvedValueOnce({ kind: "ok", parcels: [] }); // palm-beach

    const result = await ingestAddress(formDataWithAddress("123 Some Rd"));

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Property search failed");
      expect(result.error).not.toContain("outside our current coverage");
    }
  });
});
