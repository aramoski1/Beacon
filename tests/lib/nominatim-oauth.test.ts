import { describe, expect, it, vi, afterEach } from "vitest";
import { geocodeNominatim } from "@/lib/geocode";
import { oauthConfigured } from "@/lib/oauth-providers";

describe("geocodeNominatim", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns lat/lng from Nominatim json", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => [{ lat: "25.795", lon: "-80.287" }],
    }) as unknown as Response);

    await expect(geocodeNominatim("1 NW 87th Ave", "Doral")).resolves.toEqual({
      lat: 25.795,
      lng: -80.287,
    });
  });

  it("returns an error object on HTTP failure", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503 }) as unknown as Response);
    await expect(geocodeNominatim("1 Main St")).resolves.toEqual({ error: "Geocoder HTTP 503" });
  });
});

describe("oauthConfigured", () => {
  it("is false when required env keys are empty", () => {
    const prev = process.env.DOCUSIGN_INTEGRATION_KEY;
    process.env.DOCUSIGN_INTEGRATION_KEY = "";
    expect(oauthConfigured("docusign")).toBe(false);
    if (prev === undefined) delete process.env.DOCUSIGN_INTEGRATION_KEY;
    else process.env.DOCUSIGN_INTEGRATION_KEY = prev;
  });
});
