import { describe, expect, it } from "vitest";
import {
  cadenceDaysForTier,
  cadenceMapFromSettings,
  suggestedCadenceDays,
  DEFAULT_CADENCE_TIER_DAYS,
} from "../../lib/cadence";

describe("cadenceMapFromSettings", () => {
  it("returns Settings defaults when settings omitted", () => {
    expect(cadenceMapFromSettings()).toEqual(DEFAULT_CADENCE_TIER_DAYS);
    expect(cadenceMapFromSettings(null)).toEqual({ 1: 14, 2: 30, 3: 90 });
  });

  it("maps user_settings cadence fields", () => {
    expect(
      cadenceMapFromSettings({
        cadence_tier1_days: 7,
        cadence_tier2_days: 21,
        cadence_tier3_days: 60,
      }),
    ).toEqual({ 1: 7, 2: 21, 3: 60 });
  });
});

describe("cadenceDaysForTier", () => {
  const custom = { 1: 10, 2: 20, 3: 40 };

  it("returns null for missing tier", () => {
    expect(cadenceDaysForTier(null, custom)).toBeNull();
    expect(cadenceDaysForTier(undefined, custom)).toBeNull();
    expect(cadenceDaysForTier(0, custom)).toBeNull();
  });

  it("returns tier days from map", () => {
    expect(cadenceDaysForTier(1, custom)).toBe(10);
    expect(cadenceDaysForTier(2, custom)).toBe(20);
    expect(cadenceDaysForTier(3, custom)).toBe(40);
  });

  it("uses Settings defaults when map omitted", () => {
    expect(cadenceDaysForTier(1)).toBe(14);
    expect(cadenceDaysForTier(2)).toBe(30);
    expect(cadenceDaysForTier(3)).toBe(90);
  });
});

describe("suggestedCadenceDays", () => {
  it("falls back to tier-1 default when tier unset", () => {
    expect(suggestedCadenceDays(null)).toBe(14);
  });
});
