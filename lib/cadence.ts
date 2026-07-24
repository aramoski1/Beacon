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

export type CadenceChipStatus = "overdue" | "due_soon" | "ok" | "never" | "no_tier";

export type CadenceChip = {
  status: CadenceChipStatus;
  label: string;
  daysOverdue: number | null;
};

/**
 * Cadence chip for Contacts grid. due_soon = within 3 days of becoming due (daysOverdue >= -3 && < 0).
 * overdue = daysOverdue > 0; ok = on track; never = no last_contacted_at; no_tier = untiered.
 */
export function cadenceChipForContact(
  contact: {
    contact_tier: number | null;
    last_contacted_at: string | null;
  },
  map: Record<number, number> = DEFAULT_CADENCE_TIER_DAYS,
  nowMs: number = Date.now(),
): CadenceChip {
  const threshold = cadenceDaysForTier(contact.contact_tier, map);
  if (threshold == null) {
    return { status: "no_tier", label: "No tier", daysOverdue: null };
  }
  if (!contact.last_contacted_at) {
    return { status: "never", label: "Never", daysOverdue: threshold };
  }
  const daysSince = Math.floor(
    (nowMs - new Date(contact.last_contacted_at).getTime()) / 86_400_000,
  );
  const daysOverdue = daysSince - threshold;
  if (daysOverdue > 0) {
    return { status: "overdue", label: `${daysOverdue}d overdue`, daysOverdue };
  }
  if (daysOverdue >= -3) {
    return { status: "due_soon", label: daysOverdue === 0 ? "Due today" : `Due in ${-daysOverdue}d`, daysOverdue };
  }
  return { status: "ok", label: "On track", daysOverdue };
}
