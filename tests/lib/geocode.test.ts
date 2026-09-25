import { describe, it, expect, vi, afterEach } from "vitest";
import { geocodeAddress, geocodeStateFromProperty, nominatimQuery } from "../../lib/geocode";

describe("geocodeAddress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns lat/lon on a real match", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [{ coordinates: { x: -71.0796, y: 42.3494 } }],
        },
      }),
    }) as unknown as Response);

    const point = await geocodeAddress("700 Boylston St", "Boston", "MA");
    expect(point).toEqual({ lat: 42.3494, lon: -71.0796 });
  });

  it("returns null when there are no address matches (genuine miss, not an error)", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ result: { addressMatches: [] } }),
    }) as unknown as Response);

    const point = await geocodeAddress("999 Nonexistent St", "Nowhere", "MA");
    expect(point).toBeNull();
  });

  it("throws on HTTP failure rather than silently returning null", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503 }) as unknown as Response);
    await expect(geocodeAddress("700 Boylston St", "Boston", "MA")).rejects.toThrow(/503/);
  });

  it("builds a one-line address including city and state", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ result: { addressMatches: [] } }) } as unknown as Response;
    });
    await geocodeAddress("627 SW 4th Ave", "Boynton Beach", "FL");
    const decoded = decodeURIComponent(capturedUrl.replace(/\+/g, " "));
    expect(decoded).toContain("627 SW 4th Ave, Boynton Beach, FL");
  });
});

describe("nominatimQuery / geocodeStateFromProperty", () => {
  it("does not hardcode Florida when state is omitted", () => {
    expect(nominatimQuery("700 Boylston St", "Boston")).toBe("700 Boylston St, Boston, USA");
    expect(nominatimQuery("1 NW 87th Ave", "Doral", "FL")).toBe("1 NW 87th Ave, Doral, FL, USA");
    expect(nominatimQuery("700 Boylston St", "Boston", "MA")).toBe("700 Boylston St, Boston, MA, USA");
  });

  it("maps folio prefix and geographic category to FL or MA", () => {
    expect(geocodeStateFromProperty({ source_url: "magis:123" })).toBe("MA");
    expect(geocodeStateFromProperty({ source_url: "mdpa:30-4015-011-0010" })).toBe("FL");
    expect(geocodeStateFromProperty({ geographic_category: "Massachusetts" })).toBe("MA");
    expect(geocodeStateFromProperty({ geographic_category: "Miami-Dade" })).toBe("FL");
    expect(geocodeStateFromProperty({ geographic_category: "Unknown" })).toBeNull();
    expect(geocodeStateFromProperty({ city: "Boston" })).toBe("MA");
    expect(geocodeStateFromProperty({ city: "Doral" })).toBe("FL");
  });
});
