import { describe, it, expect } from "vitest";
import {
  buildSignals,
  formatWhyNow,
  formatComposeContext,
  signalPriorityScore,
  formatTimeLeft,
  type EnrichedProperty,
  type ActionSignal,
} from "@/lib/action-item-signals";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROP_DORAL: EnrichedProperty = {
  id: "prop-1",
  address: "1000 NW 87th Ave, Doral",
  size_sqft: 42000,
};

const PROP_MIAMI: EnrichedProperty = {
  id: "prop-2",
  address: "100 Brickell Ave, Miami",
  size_sqft: 15000,
};

// Boston Proper-style lot: 3,000 SF land, FAR 8 → 24,000 SF allowed,
// currently built at only 6,000 SF (25% utilized) — a real opportunity.
const PROP_UNDERBUILT: EnrichedProperty = {
  id: "prop-3",
  address: "700 Boylston St, Boston",
  size_sqft: 6000,
  land_sqft: 3000,
  zoning_far: 8,
  zoning_code: "35B-8-120c (BP)",
};

// Ordinary single-family lot with a low FAR — utilization looks "low" by the
// same math, but should NOT fire (FAR below the meaningful-density floor).
const PROP_SINGLE_FAMILY: EnrichedProperty = {
  id: "prop-4",
  address: "12 Elm St, Newton",
  size_sqft: 1800,
  land_sqft: 10000,
  zoning_far: 0.35,
  zoning_code: "SR-3",
};

// Built out close to what zoning allows — should not fire.
const PROP_BUILT_OUT: EnrichedProperty = {
  id: "prop-5",
  address: "1 Main St, Cambridge",
  size_sqft: 18000,
  land_sqft: 3000,
  zoning_far: 6,
  zoning_code: "C-2",
};

const CONTACT_TIER1 = {
  contact_tier: 1 as number | null,
  last_contacted_at: new Date(Date.now() - 93 * 86_400_000).toISOString(),
};

const CONTACT_NEVER = {
  contact_tier: 1 as number | null,
  last_contacted_at: null,
};

const NO_CHANGES = new Map<string, { newOwner: string | null }>();

const WITH_CHANGE = new Map([["prop-1", { newOwner: "New Landlord LLC" }]]);

// ─── buildSignals ─────────────────────────────────────────────────────────────

describe("buildSignals", () => {
  it("adds lease_expiring signal for an expiring linked lease", () => {
    const signals = buildSignals({
      contact: CONTACT_TIER1,
      resolvedProperties: [PROP_DORAL],
      expiringLeases: [{ leaseId: "l-1", daysUntilExpiry: 14, address: PROP_DORAL.address, sqft: PROP_DORAL.size_sqft }],
      changedProperties: NO_CHANGES,
      daysOverdue: 30,
      daysSinceContact: 93,
    });
    expect(signals.some(s => s.kind === "lease_expiring")).toBe(true);
    const ls = signals.find(s => s.kind === "lease_expiring")!;
    expect(ls.kind).toBe("lease_expiring");
    if (ls.kind === "lease_expiring") {
      expect(ls.daysUntilExpiry).toBe(14);
      expect(ls.sqft).toBe(42000);
    }
  });

  it("adds ownership_changed signal when property is in changedProperties", () => {
    const signals = buildSignals({
      contact: CONTACT_TIER1,
      resolvedProperties: [PROP_DORAL],
      expiringLeases: [],
      changedProperties: WITH_CHANGE,
      daysOverdue: 5,
      daysSinceContact: 50,
    });
    const oc = signals.find(s => s.kind === "ownership_changed");
    expect(oc).toBeDefined();
    if (oc?.kind === "ownership_changed") {
      expect(oc.newOwner).toBe("New Landlord LLC");
      expect(oc.address).toBe(PROP_DORAL.address);
    }
  });

  it("adds cadence_overdue signal when daysOverdue > 0 and contact was contacted before", () => {
    const signals = buildSignals({
      contact: CONTACT_TIER1,
      resolvedProperties: [],
      expiringLeases: [],
      changedProperties: NO_CHANGES,
      daysOverdue: 30,
      daysSinceContact: 80,
    });
    const co = signals.find(s => s.kind === "cadence_overdue");
    expect(co).toBeDefined();
    if (co?.kind === "cadence_overdue") {
      expect(co.daysOverdue).toBe(30);
      expect(co.tier).toBe(1);
    }
  });

  it("adds never_contacted signal when last_contacted_at is null", () => {
    const signals = buildSignals({
      contact: CONTACT_NEVER,
      resolvedProperties: [],
      expiringLeases: [],
      changedProperties: NO_CHANGES,
      daysOverdue: 90,
      daysSinceContact: 999,
    });
    expect(signals.some(s => s.kind === "never_contacted")).toBe(true);
    // Should NOT also add cadence_overdue
    expect(signals.some(s => s.kind === "cadence_overdue")).toBe(false);
  });

  it("sorts multiple leases most-urgent first", () => {
    const signals = buildSignals({
      contact: CONTACT_TIER1,
      resolvedProperties: [PROP_DORAL, PROP_MIAMI],
      expiringLeases: [
        { leaseId: "l-far", daysUntilExpiry: 300, address: PROP_MIAMI.address, sqft: 15000 },
        { leaseId: "l-near", daysUntilExpiry: 14, address: PROP_DORAL.address, sqft: 42000 },
      ],
      changedProperties: NO_CHANGES,
      daysOverdue: 5,
      daysSinceContact: 60,
    });
    const leases = signals.filter(s => s.kind === "lease_expiring") as Array<{ kind: "lease_expiring"; daysUntilExpiry: number }>;
    expect(leases[0].daysUntilExpiry).toBe(14);
    expect(leases[1].daysUntilExpiry).toBe(300);
  });

  it("adds zoning_opportunity when built well below what zoning (FAR) allows", () => {
    const signals = buildSignals({
      contact: CONTACT_TIER1,
      resolvedProperties: [PROP_UNDERBUILT],
      expiringLeases: [],
      changedProperties: NO_CHANGES,
      daysOverdue: 5,
      daysSinceContact: 50,
    });
    const zo = signals.find((s) => s.kind === "zoning_opportunity");
    expect(zo).toBeDefined();
    if (zo?.kind === "zoning_opportunity") {
      expect(zo.farEffective).toBe(8);
      expect(zo.builtSqft).toBe(6000);
      expect(zo.allowedSqft).toBe(24000);
      expect(zo.utilizationPct).toBe(25);
      expect(zo.zoningCode).toBe("35B-8-120c (BP)");
    }
  });

  it("does not fire zoning_opportunity below the meaningful-density FAR floor (ordinary single-family lot)", () => {
    const signals = buildSignals({
      contact: CONTACT_TIER1,
      resolvedProperties: [PROP_SINGLE_FAMILY],
      expiringLeases: [],
      changedProperties: NO_CHANGES,
      daysOverdue: 5,
      daysSinceContact: 50,
    });
    expect(signals.some((s) => s.kind === "zoning_opportunity")).toBe(false);
  });

  it("does not fire zoning_opportunity when already built close to the zoning limit", () => {
    const signals = buildSignals({
      contact: CONTACT_TIER1,
      resolvedProperties: [PROP_BUILT_OUT],
      expiringLeases: [],
      changedProperties: NO_CHANGES,
      daysOverdue: 5,
      daysSinceContact: 50,
    });
    expect(signals.some((s) => s.kind === "zoning_opportunity")).toBe(false);
  });

  it("does not fire zoning_opportunity when no zoning lookup has ever been run (zoning_far null)", () => {
    const signals = buildSignals({
      contact: CONTACT_TIER1,
      resolvedProperties: [PROP_DORAL], // no zoning_far/land_sqft set
      expiringLeases: [],
      changedProperties: NO_CHANGES,
      daysOverdue: 5,
      daysSinceContact: 50,
    });
    expect(signals.some((s) => s.kind === "zoning_opportunity")).toBe(false);
  });

  it("produces no signals when contact is on-cadence with no special properties", () => {
    const signals = buildSignals({
      contact: { contact_tier: 2, last_contacted_at: new Date().toISOString() },
      resolvedProperties: [],
      expiringLeases: [],
      changedProperties: NO_CHANGES,
      daysOverdue: -10,
      daysSinceContact: 5,
    });
    expect(signals).toHaveLength(0);
  });
});

// ─── formatWhyNow ─────────────────────────────────────────────────────────────

describe("formatWhyNow", () => {
  it("matches the expected example sentence format", () => {
    const signals: ActionSignal[] = [
      { kind: "lease_expiring", leaseId: "l-1", daysUntilExpiry: 420, address: "Doral", sqft: 42000 },
      { kind: "ownership_changed", address: "Doral", newOwner: null },
    ];
    const result = formatWhyNow(signals, "John Smith", 93);
    expect(result).toContain("John Smith");
    expect(result).toContain("42,000 SF");
    expect(result).toContain("Doral");
    expect(result).toContain("lease expires in");
    expect(result).toContain("ownership changed recently");
    expect(result).toContain("last contacted");
  });

  it("uses 'days' for short durations", () => {
    const signals: ActionSignal[] = [
      { kind: "lease_expiring", leaseId: "l-1", daysUntilExpiry: 14, address: null, sqft: null },
    ];
    const result = formatWhyNow(signals, "Alice", 30);
    expect(result).toContain("14 days");
  });

  it("includes the zoning opportunity utilization/FAR", () => {
    const signals: ActionSignal[] = [
      { kind: "zoning_opportunity", address: "700 Boylston St", zoningCode: "BP", farEffective: 8, builtSqft: 6000, allowedSqft: 24000, utilizationPct: 25 },
    ];
    const result = formatWhyNow(signals, "Erin", 50);
    expect(result).toContain("25%");
    expect(result).toContain("FAR 8");
  });

  it("uses 'months' for durations ~1–11 months", () => {
    const signals: ActionSignal[] = [
      { kind: "lease_expiring", leaseId: "l-1", daysUntilExpiry: 180, address: null, sqft: null },
    ];
    const result = formatWhyNow(signals, "Bob", 60);
    expect(result).toMatch(/\d+ months?/);
  });

  it("says 'never contacted' when daysSinceContact is 999 and signal is never_contacted", () => {
    const signals: ActionSignal[] = [{ kind: "never_contacted", tier: 1 }];
    const result = formatWhyNow(signals, "Carol", 999);
    expect(result).toContain("never contacted");
  });

  it("falls back to cadence overdue label when no other signals", () => {
    const signals: ActionSignal[] = [
      { kind: "cadence_overdue", daysOverdue: 45, tier: 2 },
    ];
    const result = formatWhyNow(signals, "Dave", 75);
    expect(result).toContain("45d overdue");
  });

  it("handles null name gracefully", () => {
    const signals: ActionSignal[] = [{ kind: "cadence_overdue", daysOverdue: 10, tier: 1 }];
    const result = formatWhyNow(signals, null, 50);
    expect(result).toContain("Contact");
  });
});

// ─── formatComposeContext ─────────────────────────────────────────────────────

describe("formatComposeContext", () => {
  it("includes CRITICAL prefix for leases expiring in ≤30 days", () => {
    const signals: ActionSignal[] = [
      { kind: "lease_expiring", leaseId: "l-1", daysUntilExpiry: 10, address: "Miami", sqft: 5000 },
    ];
    const ctx = formatComposeContext(signals, 30);
    expect(ctx).toContain("CRITICAL:");
  });

  it("includes URGENT prefix for leases expiring in 31–90 days", () => {
    const signals: ActionSignal[] = [
      { kind: "lease_expiring", leaseId: "l-1", daysUntilExpiry: 60, address: "Miami", sqft: null },
    ];
    const ctx = formatComposeContext(signals, 30);
    expect(ctx).toContain("URGENT:");
  });

  it("includes first-contact instruction when never contacted", () => {
    const signals: ActionSignal[] = [{ kind: "never_contacted", tier: 1 }];
    const ctx = formatComposeContext(signals, 999);
    expect(ctx).toContain("first contact");
  });

  it("includes days-ago line when contact has been reached before", () => {
    const signals: ActionSignal[] = [
      { kind: "cadence_overdue", daysOverdue: 30, tier: 2 },
    ];
    const ctx = formatComposeContext(signals, 75);
    expect(ctx).toContain("75 days ago");
  });

  it("includes ownership change context with new owner name", () => {
    const signals: ActionSignal[] = [
      { kind: "ownership_changed", address: "1000 NW 87th Ave", newOwner: "New Owner LLC" },
    ];
    const ctx = formatComposeContext(signals, 30);
    expect(ctx).toContain("new owner: New Owner LLC");
  });

  it("includes zoning opportunity context with built/allowed SF and a hedge, not a certainty", () => {
    const signals: ActionSignal[] = [
      { kind: "zoning_opportunity", address: "700 Boylston St", zoningCode: "BP", farEffective: 8, builtSqft: 6000, allowedSqft: 24000, utilizationPct: 25 },
    ];
    const ctx = formatComposeContext(signals, 30);
    expect(ctx).toContain("6,000 SF");
    expect(ctx).toContain("24,000 SF");
    expect(ctx).toContain("not a certainty");
  });
});

// ─── signalPriorityScore ──────────────────────────────────────────────────────

describe("signalPriorityScore", () => {
  it("scores critical lease (≤30d) highest at 100", () => {
    const signals: ActionSignal[] = [
      { kind: "lease_expiring", leaseId: "l", daysUntilExpiry: 20, address: null, sqft: null },
    ];
    expect(signalPriorityScore(signals)).toBe(100);
  });

  it("scores high lease (31–90d) at 80", () => {
    const signals: ActionSignal[] = [
      { kind: "lease_expiring", leaseId: "l", daysUntilExpiry: 60, address: null, sqft: null },
    ];
    expect(signalPriorityScore(signals)).toBe(80);
  });

  it("scores ownership change (no lease) at 30", () => {
    const signals: ActionSignal[] = [
      { kind: "ownership_changed", address: null, newOwner: null },
    ];
    expect(signalPriorityScore(signals)).toBe(30);
  });

  it("scores never_contacted at 10", () => {
    const signals: ActionSignal[] = [{ kind: "never_contacted", tier: 1 }];
    expect(signalPriorityScore(signals)).toBe(10);
  });

  it("scores zoning_opportunity (no lease/ownership change) at 20 — below ownership change, above plain cadence", () => {
    const signals: ActionSignal[] = [
      { kind: "zoning_opportunity", address: null, zoningCode: null, farEffective: 8, builtSqft: 6000, allowedSqft: 24000, utilizationPct: 25 },
    ];
    expect(signalPriorityScore(signals)).toBe(20);
  });

  it("uses most-urgent lease when multiple present", () => {
    const signals: ActionSignal[] = [
      { kind: "lease_expiring", leaseId: "far", daysUntilExpiry: 300, address: null, sqft: null },
      { kind: "lease_expiring", leaseId: "near", daysUntilExpiry: 25, address: null, sqft: null },
    ];
    expect(signalPriorityScore(signals)).toBe(100);
  });
});

// ─── formatTimeLeft ───────────────────────────────────────────────────────────

describe("formatTimeLeft", () => {
  it("uses days for ≤45 days", () => {
    expect(formatTimeLeft(14)).toBe("14 days");
    expect(formatTimeLeft(1)).toBe("1 day");
    expect(formatTimeLeft(45)).toBe("45 days");
  });

  it("uses months for 46–349 days", () => {
    expect(formatTimeLeft(90)).toBe("3 months");
    expect(formatTimeLeft(60)).toBe("2 months");
  });

  it("uses years for ≥350 days", () => {
    expect(formatTimeLeft(365)).toBe("1 year");
    expect(formatTimeLeft(730)).toBe("2 years");
  });
});
