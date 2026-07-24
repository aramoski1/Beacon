import { describe, expect, it } from "vitest";
import {
  corridorKey,
  groupBookByCorridor,
  osmSearchUrl,
} from "../../lib/book-corridors";

describe("groupBookByCorridor", () => {
  it("groups by submarket then city and filters SF", () => {
    const buckets = groupBookByCorridor(
      [
        { id: "1", address: "a", city: "Doral", submarket: "Doral", sizeSqft: 50_000, propertyType: "Industrial" },
        { id: "2", address: "b", city: "Doral", submarket: "Doral", sizeSqft: 80_000, propertyType: "Industrial" },
        { id: "3", address: "c", city: "Miami", submarket: null, sizeSqft: 20_000, propertyType: "Office" },
      ],
      { minSqft: 40_000, propertyType: "Industrial" },
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.label).toBe("Doral");
    expect(buckets[0]!.count).toBe(2);
    expect(buckets[0]!.totalSqft).toBe(130_000);
  });

  it("corridorKey prefers submarket", () => {
    expect(corridorKey({ submarket: "Medley", city: "Hialeah" })).toBe("sub:medley");
  });

  it("osmSearchUrl requires address", () => {
    expect(osmSearchUrl(null, "Doral")).toBeNull();
    expect(osmSearchUrl("100 NW 25th St", "Doral")).toMatch(/openstreetmap\.org/);
  });
});
