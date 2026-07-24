import { describe, expect, it } from "vitest";
import { cadenceChipForContact, DEFAULT_CADENCE_TIER_DAYS } from "../../lib/cadence";

describe("cadenceChipForContact", () => {
  const now = Date.parse("2026-07-24T12:00:00Z");

  it("marks never / overdue / due_soon / ok / no_tier", () => {
    expect(
      cadenceChipForContact({ contact_tier: 1, last_contacted_at: null }, DEFAULT_CADENCE_TIER_DAYS, now).status,
    ).toBe("never");

    expect(
      cadenceChipForContact(
        { contact_tier: 1, last_contacted_at: "2026-06-01T12:00:00Z" },
        DEFAULT_CADENCE_TIER_DAYS,
        now,
      ).status,
    ).toBe("overdue");

    expect(
      cadenceChipForContact(
        { contact_tier: 1, last_contacted_at: "2026-07-12T12:00:00Z" }, // 12d ago, tier1=14 → due in 2d
        DEFAULT_CADENCE_TIER_DAYS,
        now,
      ).status,
    ).toBe("due_soon");

    expect(
      cadenceChipForContact(
        { contact_tier: 1, last_contacted_at: "2026-07-20T12:00:00Z" },
        DEFAULT_CADENCE_TIER_DAYS,
        now,
      ).status,
    ).toBe("ok");

    expect(
      cadenceChipForContact({ contact_tier: null, last_contacted_at: null }, DEFAULT_CADENCE_TIER_DAYS, now).status,
    ).toBe("no_tier");
  });
});
