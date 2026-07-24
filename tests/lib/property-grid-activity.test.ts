import { describe, expect, it } from "vitest";
import {
  isPropertyActivityField,
  mergePropertyActivityPatch,
  normalizeActivityDate,
  resolveGridActivityPayload,
} from "../../lib/property-grid-activity";

describe("property-grid-activity", () => {
  it("detects activity fields", () => {
    expect(isPropertyActivityField("last_activity_date")).toBe(true);
    expect(isPropertyActivityField("owner_name")).toBe(false);
  });

  it("merges a single field patch", () => {
    expect(
      mergePropertyActivityPatch(
        { last_activity_date: null, last_activity_type: "call", last_activity_notes: "hi" },
        "last_activity_date",
        "2026-07-01",
      ),
    ).toEqual({
      last_activity_date: "2026-07-01",
      last_activity_type: "call",
      last_activity_notes: "hi",
    });
  });

  it("normalizes date-only to midday ISO", () => {
    expect(normalizeActivityDate("2026-07-01")).toBe("2026-07-01T12:00:00.000Z");
    expect(normalizeActivityDate("2026-07-01T15:00:00.000Z")).toBe("2026-07-01T15:00:00.000Z");
  });

  it("defaults type to note and uses now when date missing", () => {
    const now = "2026-07-24T12:00:00.000Z";
    expect(
      resolveGridActivityPayload(
        { last_activity_date: null, last_activity_type: null, last_activity_notes: "desk note" },
        now,
      ),
    ).toEqual({
      activity_type: "note",
      activity_date: now,
      notes: "desk note",
    });
  });
});
