import { describe, it, expect } from "vitest";
import {
  validateCreateDeal,
  isDealStale,
  daysInStage,
  nextStage,
  prevStage,
  fmtCommission,
  DEAL_STAGES,
  ACTIVE_STAGES,
  TERMINAL_STAGES,
  stagesForDealType,
  isStageAllowedForType,
  isTerminalStage,
  isActiveStage,
  type Deal,
} from "@/lib/deals";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    owner_id: "user-1",
    name: "Test Deal",
    stage: "prospect",
    deal_type: "tenant_rep",
    contact_id: null,
    property_id: null,
    estimated_commission: null,
    notes: null,
    next_action: null,
    next_action_due: null,
    expected_close_date: null,
    custom_fields: null,
    visibility: "private",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// ─── validateCreateDeal ───────────────────────────────────────────────────────

describe("validateCreateDeal", () => {
  it("returns no errors for a valid input", () => {
    const errors = validateCreateDeal({ name: "My Deal", stage: "prospect", expected_close_date: "2026-12-01" });
    expect(errors).toHaveLength(0);
  });

  it("requires name", () => {
    const errors = validateCreateDeal({ name: "" });
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("requires name when undefined", () => {
    const errors = validateCreateDeal({});
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects name over 200 characters", () => {
    const errors = validateCreateDeal({ name: "A".repeat(201) });
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("allows name of exactly 200 characters", () => {
    const errors = validateCreateDeal({ name: "A".repeat(200) });
    expect(errors.some((e) => e.field === "name")).toBe(false);
  });

  it("rejects invalid stage", () => {
    const errors = validateCreateDeal({ name: "Deal", stage: "invalid" as never });
    expect(errors.some((e) => e.field === "stage")).toBe(true);
  });

  it("accepts all valid stages for tenant_rep", () => {
    const notInTenantRep = ["under_contract", "psa_signed", "due_diligence"];
    for (const stage of DEAL_STAGES) {
      if (notInTenantRep.includes(stage)) continue;
      const errors = validateCreateDeal({ name: "Deal", stage, deal_type: "tenant_rep" });
      expect(errors.some((e) => e.field === "stage")).toBe(false);
    }
  });

  it("rejects requirement stage for listing deals", () => {
    const errors = validateCreateDeal({
      name: "Deal",
      stage: "requirement",
      deal_type: "listing",
    });
    expect(errors.some((e) => e.field === "stage")).toBe(true);
  });

  it("accepts under_contract for investment_sale", () => {
    const errors = validateCreateDeal({
      name: "Deal",
      stage: "under_contract",
      deal_type: "investment_sale",
    });
    expect(errors.some((e) => e.field === "stage")).toBe(false);
  });

  it("rejects negative commission", () => {
    const errors = validateCreateDeal({ name: "Deal", estimated_commission: -1 });
    expect(errors.some((e) => e.field === "estimated_commission")).toBe(true);
  });

  it("accepts zero commission", () => {
    const errors = validateCreateDeal({ name: "Deal", estimated_commission: 0 });
    expect(errors.some((e) => e.field === "estimated_commission")).toBe(false);
  });

  it("accepts positive commission", () => {
    const errors = validateCreateDeal({ name: "Deal", estimated_commission: 25000, expected_close_date: "2026-12-01" });
    expect(errors).toHaveLength(0);
  });

  it("requires expected close date", () => {
    const errors = validateCreateDeal({ name: "Deal" });
    expect(errors.some((e) => e.field === "expected_close_date")).toBe(true);
  });
});

// ─── isDealStale ──────────────────────────────────────────────────────────────

describe("isDealStale", () => {
  it("returns false for a deal updated today", () => {
    const deal = makeDeal({ updated_at: new Date().toISOString() });
    expect(isDealStale(deal)).toBe(false);
  });

  it("returns false for a deal updated 13 days ago (default 14-day threshold)", () => {
    const deal = makeDeal({ updated_at: daysAgo(13) });
    expect(isDealStale(deal)).toBe(false);
  });

  it("returns true for a deal updated 14+ days ago", () => {
    const deal = makeDeal({ updated_at: daysAgo(14) });
    expect(isDealStale(deal)).toBe(true);
  });

  it("never marks terminal stages as stale", () => {
    for (const stage of TERMINAL_STAGES) {
      const deal = makeDeal({ stage, updated_at: daysAgo(100) });
      expect(isDealStale(deal)).toBe(false);
    }
  });

  it("respects custom staleDays threshold", () => {
    const deal = makeDeal({ updated_at: daysAgo(7) });
    expect(isDealStale(deal, 7)).toBe(true);
    expect(isDealStale(deal, 8)).toBe(false);
  });
});

// ─── daysInStage ─────────────────────────────────────────────────────────────

describe("daysInStage", () => {
  it("returns 0 for a deal updated just now", () => {
    const deal = makeDeal({ updated_at: new Date().toISOString() });
    expect(daysInStage(deal)).toBe(0);
  });

  it("returns correct day count", () => {
    const deal = makeDeal({ updated_at: daysAgo(10) });
    expect(daysInStage(deal)).toBe(10);
  });
});

// ─── nextStage / prevStage ────────────────────────────────────────────────────

describe("nextStage", () => {
  it("advances from prospect to contacted", () => {
    expect(nextStage("prospect")).toBe("contacted");
  });

  it("returns null from the last stage (lost)", () => {
    expect(nextStage("lost")).toBeNull();
  });

  it("covers all consecutive stage transitions for full set", () => {
    for (let i = 0; i < DEAL_STAGES.length - 1; i++) {
      expect(nextStage(DEAL_STAGES[i])).toBe(DEAL_STAGES[i + 1]);
    }
  });

  it("skips requirement for listing deals", () => {
    expect(nextStage("meeting", "listing")).toBe("proposal");
    expect(nextStage("proposal", "listing")).toBe("loi_sent");
  });
});

describe("stagesForDealType", () => {
  it("includes requirement only for tenant_rep", () => {
    expect(stagesForDealType("tenant_rep")).toContain("requirement");
    expect(stagesForDealType("listing")).not.toContain("requirement");
    expect(stagesForDealType("investment_sale")).toContain("under_contract");
  });
});

describe("prevStage", () => {
  it("goes back from contacted to prospect", () => {
    expect(prevStage("contacted")).toBe("prospect");
  });

  it("returns null from the first stage (prospect)", () => {
    expect(prevStage("prospect")).toBeNull();
  });
});

// ─── fmtCommission ────────────────────────────────────────────────────────────

describe("fmtCommission", () => {
  it("formats values under 1K as dollars", () => {
    expect(fmtCommission(500)).toBe("$500");
  });

  it("formats values in thousands as K", () => {
    expect(fmtCommission(25000)).toBe("$25K");
  });

  it("formats values in millions as M", () => {
    expect(fmtCommission(1_500_000)).toBe("$1.5M");
  });
});

// ─── Stage constants ─────────────────────────────────────────────────────────

describe("stage constants", () => {
  it("ACTIVE_STAGES contains no terminal stages", () => {
    for (const s of ACTIVE_STAGES) {
      expect(TERMINAL_STAGES).not.toContain(s);
    }
  });

  it("TERMINAL_STAGES are closed and lost only", () => {
    expect([...TERMINAL_STAGES].sort()).toEqual(["closed", "lost"]);
  });

  it("under_contract and won stay active (CRE pipeline)", () => {
    expect(isActiveStage("under_contract")).toBe(true);
    expect(isActiveStage("won")).toBe(true);
    expect(isTerminalStage("under_contract")).toBe(false);
    expect(isTerminalStage("won")).toBe(false);
    expect(isTerminalStage("closed")).toBe(true);
    expect(isTerminalStage("lost")).toBe(true);
  });

  it("rejects illegal stage for deal type", () => {
    expect(isStageAllowedForType("requirement", "listing")).toBe(false);
    expect(isStageAllowedForType("under_contract", "tenant_rep")).toBe(false);
    expect(isStageAllowedForType("won", "tenant_rep")).toBe(true);
  });

  it("TERMINAL_STAGES are all in DEAL_STAGES", () => {
    for (const s of TERMINAL_STAGES) {
      expect(DEAL_STAGES).toContain(s);
    }
  });

  it("DEAL_STAGES has 15 entries", () => {
    expect(DEAL_STAGES).toHaveLength(15);
  });
});
