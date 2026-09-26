import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  differenceInCalendarDays,
  formatLocalDate,
  parseLocalDate,
} from "../../lib/dates";

describe("parseLocalDate", () => {
  it("does not shift a date-only string by timezone", () => {
    const d = parseLocalDate("2026-10-04");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(9);
    expect(d?.getDate()).toBe(4);
  });
});

describe("differenceInCalendarDays", () => {
  it("counts calendar days, not UTC midnights", () => {
    expect(differenceInCalendarDays("2026-10-04", "2026-10-03")).toBe(1);
    expect(differenceInCalendarDays("2026-10-03", "2026-10-04")).toBe(-1);
  });
});

describe("formatLocalDate", () => {
  it("formats Oct 4 as October 4", () => {
    expect(formatLocalDate("2026-10-04", { month: "short", day: "numeric" })).toBe("Oct 4");
  });
});

describe("addCalendarDays", () => {
  it("adds across month bounds", () => {
    expect(addCalendarDays("2026-10-30", 5)).toBe("2026-11-04");
  });
});
