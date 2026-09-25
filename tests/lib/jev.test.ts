import { afterEach, describe, expect, it, vi } from "vitest";
import { jevChoice, jevDecide, jevEnabled, jevNoul, jevTextPreview } from "@/lib/jev";
import { jevAllowsListingExtract, jevAllowsUrlIngest } from "@/lib/jev-gates";
import { parseCrmSearchHints } from "@/lib/jev-crm-search";
import { parseLeadSearchHints } from "@/lib/jev-lead-search";
import { blendTodayDeskScores } from "@/lib/jev-today-desk";
import type { TodayDeskItem } from "@/lib/today-desk";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("jevEnabled", () => {
  it("is off without a key", () => {
    vi.stubEnv("JEV_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(jevEnabled()).toBe(false);
  });

  it("accepts JEV_API_KEY", () => {
    vi.stubEnv("JEV_API_KEY", "apikey_test");
    expect(jevEnabled()).toBe(true);
  });
});

describe("jevDecide", () => {
  it("returns null when fetch fails", async () => {
    vi.stubEnv("JEV_API_KEY", "apikey_test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const out = await jevDecide("hello", {
      ok: { type: "noul", instructions: "greeting?" },
    });
    expect(out).toBeNull();
  });

  it("parses noul and choice answers", async () => {
    vi.stubEnv("JEV_API_KEY", "apikey_test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: "jev-1.13.0",
          answers: {
            ok: { type: "noul", noul: 0.91 },
            target: {
              type: "choice",
              choice: "properties",
              confidence: 0.88,
            },
          },
        }),
      }),
    );
    const out = await jevDecide("q", {
      ok: { type: "noul", instructions: "yes?" },
      target: {
        type: "choice",
        instructions: "table",
        criteria: { properties: "p", contacts: "c" },
      },
    });
    expect(jevNoul(out, "ok")).toBe(0.91);
    expect(jevChoice(out, "target")).toEqual({ choice: "properties", confidence: 0.88 });
  });
});

describe("parseCrmSearchHints", () => {
  it("reads industrial over 50k in Doral as a property search", () => {
    const r = parseCrmSearchHints("industrial over 50k SF in Doral");
    expect(r.target).toBe("properties");
    expect(r.properties?.property_type).toBe("industrial");
    expect(r.properties?.size_sqft_min).toBe(50000);
    expect(r.properties?.geographic_keyword?.toLowerCase()).toContain("doral");
  });

  it("reads tier 1 overdue as contacts", () => {
    const r = parseCrmSearchHints("tier 1 overdue contacts");
    expect(r.target).toBe("contacts");
    expect(r.contacts?.contact_tier).toBe(1);
    expect(r.contacts?.cadence_status).toBe("overdue");
  });

  it("reads expiring leases", () => {
    const r = parseCrmSearchHints("leases expiring soon");
    expect(r.target).toBe("leases");
    expect(r.leases?.status).toBe("expiring");
  });
});

describe("parseLeadSearchHints", () => {
  it("maps 20-50k industrial in Hialeah", () => {
    const c = parseLeadSearchHints("20-50k industrial in Hialeah");
    expect(c.propertyType).toBe("industrial");
    expect(c.buildingSqftMin).toBe(20000);
    expect(c.buildingSqftMax).toBe(50000);
    expect(c.cities?.[0]).toMatch(/Hialeah/i);
  });
});

describe("jevTextPreview", () => {
  it("truncates long text", () => {
    expect(jevTextPreview("a".repeat(10), 4)).toBe("aaaa…");
  });
});

describe("listing/document gates", () => {
  it("allows when Jev is off", async () => {
    vi.stubEnv("JEV_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    await expect(
      jevAllowsListingExtract({
        address: "100 Main St",
        city: "Miami",
        url: "https://example.com",
        pageText: "unrelated",
      }),
    ).resolves.toBe(true);
  });

  it("rejects a confident non-listing", async () => {
    vi.stubEnv("JEV_API_KEY", "apikey_test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          answers: { same_listing: { type: "noul", noul: 0.08 } },
        }),
      }),
    );
    await expect(
      jevAllowsListingExtract({
        address: "100 Main St",
        city: "Miami",
        url: "https://example.com/search",
        pageText: "10,000 industrial listings in Miami",
      }),
    ).resolves.toBe(false);
  });

  it("allows a middling or failed call", async () => {
    vi.stubEnv("JEV_API_KEY", "apikey_test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    await expect(
      jevAllowsUrlIngest({ url: "https://example.com", pageText: "x" }),
    ).resolves.toBe(true);
  });
});

describe("blendTodayDeskScores", () => {
  const lease: TodayDeskItem = {
    id: "lease:1",
    kind: "lease_urgent",
    score: 100,
    title: "1 Main",
    why: "expires",
    href: "/lease-radar",
  };
  const outreach: TodayDeskItem = {
    id: "out:1",
    kind: "outreach",
    score: 30,
    title: "Pat",
    why: "overdue",
    href: "/contacts/1",
  };

  it("leaves lease scores alone and nudges outreach", () => {
    const out = blendTodayDeskScores([lease, outreach], { "out:1": 0.1, "lease:1": 0 });
    expect(out.find((i) => i.id === "lease:1")?.score).toBe(100);
    expect(out.find((i) => i.id === "out:1")?.score).toBeLessThan(30);
    expect(out[0]?.id).toBe("lease:1");
  });
});
