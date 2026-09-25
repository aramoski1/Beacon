import "./load-local-env";
import { describe, expect, it } from "vitest";
import { jevDecide, jevEnabled, jevNoul } from "@/lib/jev";
import { interpretCrmSearchWithJev } from "@/lib/jev-crm-search";
import { interpretLeadSearchWithJev } from "@/lib/jev-lead-search";
import { routeCopilotQuestion } from "@/lib/jev-copilot";
import { jevAllowsListingExtract, jevAllowsUrlIngest } from "@/lib/jev-gates";

const live = jevEnabled();

describe.skipIf(!live)("Jev live API", () => {
  it("answers a noul", async () => {
    const out = await jevDecide("Please help ASAP, production is down.", {
      urgent: { type: "noul", instructions: "Does this express urgency?" },
    });
    expect(out).not.toBeNull();
    expect(jevNoul(out, "urgent")).toBeGreaterThan(0.7);
  }, 20_000);

  it("interprets an industrial property CRM search", async () => {
    const r = await interpretCrmSearchWithJev("industrial over 50k SF in Doral");
    expect(r).not.toBeNull();
    expect(r?.target).toBe("properties");
    expect(r?.properties?.property_type).toBe("industrial");
    expect(r?.properties?.size_sqft_min).toBe(50000);
  }, 20_000);

  it("interprets a Hialeah prospect sentence", async () => {
    const r = await interpretLeadSearchWithJev("20-50k industrial in Hialeah");
    expect(r).not.toBeNull();
    expect(r?.criteria.propertyType).toBe("industrial");
    expect(r?.criteria.cities).toEqual(["Hialeah"]);
    expect(r?.criteria.markets).toEqual(["miami-dade"]);
  }, 20_000);

  it("does not false-positive a book question as cannot_do", async () => {
    const route = await routeCopilotQuestion("Who haven't I called in 90 days?");
    expect(route).not.toBe("cannot_do");
  }, 20_000);

  it("allows a matching listing snippet", async () => {
    const ok = await jevAllowsListingExtract({
      address: "7900 NW 27th Avenue",
      city: "Miami",
      url: "https://www.loopnet.com/Listing/7900-NW-27th-Ave-Miami-FL/123",
      pageText:
        "7900 NW 27th Avenue, Miami industrial warehouse for lease. 24' clear height, 12 dock-high doors, ESFR.",
    });
    expect(ok).toBe(true);
  }, 20_000);

  it("rejects a search-results page for URL ingest", async () => {
    const ok = await jevAllowsUrlIngest({
      url: "https://www.loopnet.com/search/industrial-space/miami-fl/",
      pageText:
        "Search industrial listings in Miami. 1–25 of 4,812 results. Refine by size, price, and submarket.",
    });
    expect(ok).toBe(false);
  }, 20_000);
});
