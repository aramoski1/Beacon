import { describe, expect, it } from "vitest";
import {
  buildTodayDeskItems,
  daysPastDue,
  scoreDealDue,
  scoreFollowUp,
  scoreLeaseUrgent,
  scoreOutreach,
  scoreOwnershipChange,
} from "../../lib/today-desk";

describe("scoreLeaseUrgent", () => {
  it("prioritizes ≤30d then ≤90d", () => {
    expect(scoreLeaseUrgent(10)).toBe(100);
    expect(scoreLeaseUrgent(90)).toBe(90);
    expect(scoreLeaseUrgent(91)).toBe(0);
    expect(scoreLeaseUrgent(-1)).toBe(0);
  });
});

describe("scoreFollowUp / scoreDealDue", () => {
  const today = "2026-07-24";

  it("scores overdue follow-ups above due today", () => {
    expect(scoreFollowUp("2026-07-24", today)).toBe(65);
    expect(scoreFollowUp("2026-07-20", today)).toBeGreaterThan(65);
    expect(scoreFollowUp("2026-07-25", today)).toBe(0);
  });

  it("scores deal next_action_due only when due", () => {
    expect(scoreDealDue(null, today)).toBe(0);
    expect(scoreDealDue("2026-07-24", today)).toBe(55);
    expect(scoreDealDue("2026-07-10", today)).toBeGreaterThan(55);
    expect(scoreDealDue("2026-08-01", today)).toBe(0);
  });

  it("daysPastDue counts calendar days", () => {
    expect(daysPastDue("2026-07-22", today)).toBe(2);
    expect(daysPastDue(today, today)).toBe(0);
  });
});

describe("scoreOutreach", () => {
  it("keeps cadence below structural CRE scores", () => {
    expect(scoreOutreach(100, 5)).toBeLessThanOrEqual(50);
    expect(scoreOutreach(10, -1)).toBe(0);
    expect(scoreOwnershipChange()).toBeGreaterThan(scoreOutreach(40, 3));
  });
});

describe("buildTodayDeskItems", () => {
  it("merges kinds and sorts by score", () => {
    const items = buildTodayDeskItems({
      today: "2026-07-24",
      outreach: [
        {
          id: "c1",
          name: "Cold Owner",
          whyNow: "Cold Owner — 20d overdue",
          daysOverdue: 20,
          priorityScore: 25,
        },
      ],
      followUps: [
        {
          id: "f1",
          description: "Call about renewal",
          due_date: "2026-07-24",
          contact_name: "Jane",
          property_address: null,
        },
      ],
      deals: [
        {
          id: "d1",
          name: "Doral pursuit",
          next_action: "Send LOI",
          next_action_due: "2026-07-20",
          contact_name: "Bob",
        },
      ],
      ownership: [
        {
          id: "p1",
          address: "100 Industrial Way",
          previous_owner: "Old LLC",
          new_owner: "New LLC",
        },
      ],
      leases: [
        {
          id: "l1",
          property_address: "200 Warehouse Blvd",
          daysUntilExpiry: 14,
          property_id: "p2",
        },
      ],
      limit: 10,
    });

    expect(items[0]?.kind).toBe("lease_urgent");
    expect(items.map((i) => i.kind)).toContain("ownership");
    expect(items.map((i) => i.kind)).toContain("follow_up");
    expect(items.map((i) => i.kind)).toContain("deal_due");
    expect(items.map((i) => i.kind)).toContain("outreach");
    // Scores descending
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.score).toBeGreaterThanOrEqual(items[i]!.score);
    }
  });

  it("returns empty when nothing is due", () => {
    expect(
      buildTodayDeskItems({
        today: "2026-07-24",
        outreach: [{ id: "c", name: "x", whyNow: "x", daysOverdue: -5, priorityScore: 10 }],
        followUps: [],
        deals: [{ id: "d", name: "n", next_action: null, next_action_due: "2026-08-01" }],
        ownership: [],
        leases: [{ id: "l", property_address: "a", daysUntilExpiry: 200, property_id: null }],
      }),
    ).toEqual([]);
  });
});
