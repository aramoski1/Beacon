import { describe, expect, it } from "vitest";
import {
  normalizeOwnerName,
  ownersDiffer,
  ownershipWatchEmptyCopy,
  saleDatesDiffer,
} from "../../lib/ownership-watch";

describe("ownersDiffer", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeOwnerName("  Foo  LLC ")).toBe("FOO LLC");
    expect(ownersDiffer("Foo LLC", "foo  llc")).toBe(false);
    expect(ownersDiffer("Foo LLC", "Bar LLC")).toBe(true);
  });
});

describe("saleDatesDiffer", () => {
  it("compares year-month for Broward", () => {
    expect(saleDatesDiffer("2024-03-15", "2024-03-01", "year_month")).toBe(false);
    expect(saleDatesDiffer("2024-03-15", "2024-04-01", "year_month")).toBe(true);
    expect(saleDatesDiffer("2024-03-15", "2024-03-01", "full")).toBe(true);
  });
});

describe("ownershipWatchEmptyCopy", () => {
  it("distinguishes not enrolled vs not checked vs quiet", () => {
    expect(ownershipWatchEmptyCopy({ openSignals: 0, enrolledCount: 0, everChecked: false })).toMatch(
      /No properties on ownership watch/i,
    );
    expect(ownershipWatchEmptyCopy({ openSignals: 0, enrolledCount: 3, everChecked: false })).toMatch(
      /not checked yet/i,
    );
    expect(ownershipWatchEmptyCopy({ openSignals: 0, enrolledCount: 3, everChecked: true })).toMatch(
      /No open ownership flips/i,
    );
    expect(ownershipWatchEmptyCopy({ openSignals: 2, enrolledCount: 5, everChecked: true })).toMatch(
      /2 open/i,
    );
  });
});
