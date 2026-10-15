import { describe, expect, it } from "vitest";
import {
  buildTodayDeskItems,
  daysPastDue,
  scoreDealDue,
  scoreFollowUp,
  scoreDatedDeadline,
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

describe("scoreDatedDeadline", () => {
  it("matches lease urgency for upcoming dates and bumps overdue", () => {
    expect(scoreDatedDeadline(10)).toBe(100);
    expect(scoreDatedDeadline(90)).toBe(90);
    expect(scoreDatedDeadline(91)).toBe(0);
    expect(scoreDatedDeadline(-1)).toBeGreaterThan(100);
    expect(scoreDatedDeadline(-20)).toBe(110);
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
      optionNotices: [
        {
          id: "l2",
          property_address: "300 Flex Park",
          daysUntil: 12,
          label: "Notice Deadline — Renewal Option",
          href: "/abstracts/l2",
          dueDate: "2026-08-05",
        },
      ],
      exchange1031: [
        {
          id: "c-1031",
          name: "1031 Buyer",
          daysUntil: 22,
          deadline: "2026-08-15",
        },
      ],
      limit: 10,
    });

    expect(items.map((i) => i.kind)).toContain("lease_urgent");
    expect(items.map((i) => i.kind)).toContain("ownership");
    expect(items.map((i) => i.kind)).toContain("follow_up");
    expect(items.find((i) => i.kind === "deal_due")?.href).toBe("/deals/d1");
    expect(items.map((i) => i.kind)).toContain("outreach");
    expect(items.map((i) => i.kind)).toContain("option_notice");
    expect(items.map((i) => i.kind)).toContain("exchange_1031");
    // Scores descending
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.score).toBeGreaterThanOrEqual(items[i]!.score);
    }
  });

  it("breaks same-score lease ties by sooner expiry", () => {
    const items = buildTodayDeskItems({
      today: "2026-07-24",
      outreach: [],
      followUps: [],
      deals: [],
      ownership: [],
      leases: [
        { id: "later", property_address: "Z later", daysUntilExpiry: 20, property_id: "p1" },
        { id: "sooner", property_address: "A sooner", daysUntilExpiry: 9, property_id: "p2" },
      ],
    });
    expect(items[0]?.id).toBe("lease:sooner");
    expect(items[1]?.id).toBe("lease:later");
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
