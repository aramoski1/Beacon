import { describe, expect, it } from "vitest";
import { formatPsf, roundPsf } from "../../lib/format-money";

describe("formatPsf", () => {
  it("rounds long floats", () => {
    expect(formatPsf(19.594335277256093)).toBe("$19.59/sf");
  });
  it("keeps one-decimal values at two places", () => {
    expect(formatPsf(16.5)).toBe("$16.50/sf");
  });
  it("returns null for empty", () => {
    expect(formatPsf(null)).toBeNull();
    expect(formatPsf(undefined)).toBeNull();
  });
});

describe("roundPsf", () => {
  it("stores two decimals", () => {
    expect(roundPsf(19.594335277256093)).toBe(19.59);
  });
});
