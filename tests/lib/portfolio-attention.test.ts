import { describe, expect, it } from "vitest";
import { buildPortfolioAttentionFlags } from "../../lib/portfolio-attention";

describe("buildPortfolioAttentionFlags", () => {
  it("surfaces ownership changes as critical", () => {
    const flags = buildPortfolioAttentionFlags({
      properties: [
        {
          id: "p1",
          address: "100 Main",
          ownership_change_detected_at: new Date().toISOString(),
          ownership_change_data: { previous_owner: "A LLC", new_owner: "B LLC" },
        },
      ],
      leases: [],
      contacts: [],
    });
    expect(flags[0]).toMatchObject({
      kind: "ownership_change",
      severity: "critical",
      href: "/properties/p1",
    });
  });

  it("flags near-term lease expirations", () => {
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const flags = buildPortfolioAttentionFlags({
      properties: [],
      leases: [{ id: "l1", expiration_date: soon, source_document: "lease.pdf" }],
      contacts: [],
    });
    expect(flags.some((f) => f.kind === "lease_expiring")).toBe(true);
  });

  it("flags cold tier-1 contacts", () => {
    const flags = buildPortfolioAttentionFlags({
      properties: [],
      leases: [],
      contacts: [
        {
          id: "c1",
          name: "Pat",
          contact_tier: 1,
          last_contacted_at: null,
        },
      ],
    });
    expect(flags[0].kind).toBe("cold_contact");
  });
});
