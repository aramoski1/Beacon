// Dashboard show/hide customization — module catalog + resolution.
//
// Visibility only: no drag-and-drop, no reordering. Beacon's fixed section
// order (hero → KPIs → signals → primary → secondary) never changes; this
// only controls whether a given block renders at all. DashboardHero and Ask
// Beacon (BeaconCopilot) are never in this catalog — they're not hideable,
// full stop, so there's no id for them to accidentally toggle off.
//
// Persisted as user_settings.dashboard_layout JSONB:
//   { "version": 1, "visible": { "<module_id>": boolean, ... } }
// A missing column, a null value, or a missing key all mean "visible" — an
// account that has never touched Customize must render pixel-identical to
// today's fixed layout. resolveVisible is the single place that guarantee
// lives; nothing else should read the raw JSONB column directly.

export const KPI_MODULE_IDS = [
  "kpi_pursuits",
  "kpi_leases_90",
  "kpi_tier1_overdue",
  "kpi_ownership",
  "kpi_book",
] as const;

export const SIGNAL_MODULE_IDS = [
  "priority_pills",
  "week_momentum",
  "since_last_visit",
] as const;

export const PRIMARY_MODULE_IDS = [
  "today_desk",
  "upcoming_followups",
  "ready_to_pursue",
  "cold_tier1",
  "stale_tier1_owners",
] as const;

export const SECONDARY_MODULE_IDS = [
  "pipeline",
  "lease_exposure",
  "book_owners",
  "cadence",
  "ops_health",
  "recent_activity",
] as const;

export const ALL_MODULE_IDS = [
  ...KPI_MODULE_IDS,
  ...SIGNAL_MODULE_IDS,
  ...PRIMARY_MODULE_IDS,
  ...SECONDARY_MODULE_IDS,
] as const;

export type KpiModuleId = (typeof KPI_MODULE_IDS)[number];
export type SignalModuleId = (typeof SIGNAL_MODULE_IDS)[number];
export type PrimaryModuleId = (typeof PRIMARY_MODULE_IDS)[number];
export type SecondaryModuleId = (typeof SECONDARY_MODULE_IDS)[number];
export type ModuleId = (typeof ALL_MODULE_IDS)[number];

const MODULE_ID_SET: ReadonlySet<string> = new Set(ALL_MODULE_IDS);

export function isModuleId(id: string): id is ModuleId {
  return MODULE_ID_SET.has(id);
}

export const DEFAULT_VISIBLE: Readonly<Record<ModuleId, true>> = Object.fromEntries(
  ALL_MODULE_IDS.map((id) => [id, true]),
) as Record<ModuleId, true>;

export type DashboardLayoutPrefs = {
  version: 1;
  visible: Partial<Record<ModuleId, boolean>>;
};

/**
 * Resolves stored prefs (possibly null/undefined, possibly missing keys)
 * into a complete visibility map. Missing keys → true, matching "default =
 * everything visible" for both brand-new accounts and any module id added
 * to the catalog after a broker already saved a partial layout.
 */
export function resolveVisible(
  prefs: DashboardLayoutPrefs | null | undefined,
): Record<ModuleId, boolean> {
  const result: Record<ModuleId, boolean> = { ...DEFAULT_VISIBLE };
  const stored = prefs?.visible;
  if (!stored) return result;
  for (const id of ALL_MODULE_IDS) {
    const v = stored[id];
    if (typeof v === "boolean") result[id] = v;
  }
  return result;
}

/**
 * Validates a broker-submitted patch of {moduleId: boolean} before it's
 * merged and persisted — rejects unknown keys and non-boolean values rather
 * than silently dropping or coercing them, so a client bug surfaces instead
 * of writing garbage into the JSONB column.
 */
export function sanitizeVisiblePatch(
  input: unknown,
): { ok: true; visible: Partial<Record<ModuleId, boolean>> } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid layout payload." };
  }
  const visible: Partial<Record<ModuleId, boolean>> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isModuleId(key)) return { ok: false, error: `Unknown dashboard module: "${key}"` };
    if (typeof value !== "boolean") return { ok: false, error: `Invalid value for "${key}" — expected true/false.` };
    visible[key] = value;
  }
  return { ok: true, visible };
}

// ─── Customize UI metadata ─────────────────────────────────────────────────────

export type ModuleGroupId = "kpis" | "signals" | "primary" | "secondary";

export const MODULE_GROUPS: { id: ModuleGroupId; label: string; moduleIds: readonly ModuleId[] }[] = [
  { id: "kpis", label: "KPIs", moduleIds: KPI_MODULE_IDS },
  { id: "signals", label: "Signals", moduleIds: SIGNAL_MODULE_IDS },
  { id: "primary", label: "Primary", moduleIds: PRIMARY_MODULE_IDS },
  { id: "secondary", label: "Secondary", moduleIds: SECONDARY_MODULE_IDS },
];

export const MODULE_LABELS: Record<ModuleId, string> = {
  kpi_pursuits: "Active pursuits",
  kpi_leases_90: "Leases ≤90 days",
  kpi_tier1_overdue: "Tier-1 overdue",
  kpi_ownership: "Ownership changes",
  kpi_book: "Book size",
  priority_pills: "Priority pills",
  week_momentum: "This week's momentum",
  since_last_visit: "Since last visit",
  today_desk: "Do these today",
  upcoming_followups: "Upcoming follow-ups",
  ready_to_pursue: "Ready to pursue",
  cold_tier1: "Tier 1 going cold",
  stale_tier1_owners: "Tier-1 owners not contacted",
  pipeline: "Pipeline",
  lease_exposure: "Lease exposure",
  book_owners: "Book & owners",
  cadence: "Relationship cadence",
  ops_health: "Ops & data health",
  recent_activity: "Recent activity",
};
