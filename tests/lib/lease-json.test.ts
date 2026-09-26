import { describe, expect, it } from "vitest";
import { asKeyProvisions } from "../../lib/lease-json";

describe("asKeyProvisions", () => {
  it("passes through a list", () => {
    expect(asKeyProvisions([{ provision: "NNN" }])).toEqual([{ provision: "NNN" }]);
  });
  it("flattens the demo seed object so .map is safe", () => {
    const rows = asKeyProvisions({
      tenant: "Priya Shah",
      use: "Warehousing",
      notes: "[Demo] Synthetic abstract",
    });
    expect(rows.length).toBe(3);
    expect(rows[0].provision).toBe("Priya Shah");
  });
  it("returns [] for null", () => {
    expect(asKeyProvisions(null)).toEqual([]);
  });
});
