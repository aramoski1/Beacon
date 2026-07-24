/**
 * Pure helpers for ownership watch / change detection.
 */

export function normalizeOwnerName(name: string | null | undefined): string {
  return (name ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function ownersDiffer(
  stored: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  return normalizeOwnerName(stored) !== normalizeOwnerName(incoming);
}

/** Sale date compare — Broward is year-month only. */
export function saleDatesDiffer(
  stored: string | null | undefined,
  incoming: string | null | undefined,
  mode: "full" | "year_month",
): boolean {
  if (mode === "year_month") {
    return (stored ?? "").slice(0, 7) !== (incoming ?? "").slice(0, 7);
  }
  return (stored ?? "").slice(0, 10) !== (incoming ?? "").slice(0, 10);
}

export function ownershipWatchEmptyCopy(opts: {
  openSignals: number;
  enrolledCount: number;
  everChecked: boolean;
}): string {
  if (opts.openSignals > 0) {
    return `${opts.openSignals} open ownership change${opts.openSignals === 1 ? "" : "s"} — verify who to call.`;
  }
  if (opts.enrolledCount === 0) {
    return "No properties on ownership watch yet. Enroll from a property page, then run a batch re-check.";
  }
  if (!opts.everChecked) {
    return "Watch list enrolled but not checked yet — empty here means not checked, not market quiet.";
  }
  return "No open ownership flips on watched properties. Re-check periodically — signals appear when county owner/sale differs.";
}
