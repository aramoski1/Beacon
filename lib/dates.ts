/** Date-only (YYYY-MM-DD) helpers that never treat a calendar day as UTC midnight. */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function todayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  const m = DATE_ONLY.exec(day);
  if (!m) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatLocalDate(
  value: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string | null {
  const d = parseLocalDate(value);
  if (!d) return null;
  return d.toLocaleDateString("en-US", opts);
}

/** Full timestamps (tours, activity). Date-only values still parse as local midnight. */
export function formatLocalDateTime(
  value: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
): string | null {
  if (!value) return null;
  const d = DATE_ONLY.test(value.slice(0, 10)) && value.length <= 10
    ? parseLocalDate(value)
    : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", opts);
}

export function differenceInCalendarDays(
  later: string | Date,
  earlier: string | Date,
): number {
  const a = typeof later === "string" ? parseLocalDate(later) : later;
  const b = typeof earlier === "string" ? parseLocalDate(earlier) : earlier;
  if (!a || !b) return 0;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / 86_400_000);
}

export function addCalendarDays(isoDay: string, days: number): string {
  const d = parseLocalDate(isoDay);
  if (!d) return isoDay;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysUntilDay(isoDay: string | null | undefined, today = todayLocal()): number | null {
  if (!isoDay) return null;
  return differenceInCalendarDays(isoDay.slice(0, 10), today);
}
