/**
 * Tier cadence helpers — single source of truth matching Settings defaults.
 * Client-safe; no server imports.
 */

export const DEFAULT_CADENCE_TIER_DAYS: Record<number, number> = {
  1: 14,
  2: 30,
  3: 90,
};

export type CadenceSettingsSlice = {
  cadence_tier1_days: number;
  cadence_tier2_days: number;
  cadence_tier3_days: number;
};

/** Build tier → days map from user_settings (or defaults). */
export function cadenceMapFromSettings(
  settings?: CadenceSettingsSlice | null,
): Record<number, number> {
  if (!settings) return { ...DEFAULT_CADENCE_TIER_DAYS };
  return {
    1: settings.cadence_tier1_days,
    2: settings.cadence_tier2_days,
    3: settings.cadence_tier3_days,
  };
}

/** Days between touches for a contact tier; null if tier unset/unknown. */
export function cadenceDaysForTier(
  tier: number | null | undefined,
  map: Record<number, number> = DEFAULT_CADENCE_TIER_DAYS,
): number | null {
  if (tier == null) return null;
  const days = map[tier];
  return typeof days === "number" && days > 0 ? days : null;
}

/** Suggested follow-up interval for UI (falls back to Tier 1 default). */
export function suggestedCadenceDays(
  tier: number | null | undefined,
  map: Record<number, number> = DEFAULT_CADENCE_TIER_DAYS,
): number {
  return cadenceDaysForTier(tier, map) ?? map[1] ?? DEFAULT_CADENCE_TIER_DAYS[1];
}
