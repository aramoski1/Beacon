/** Hide seeder fingerprints in broker UI. Values stay in the DB. */

export function stripDemoLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/\[Demo\]\s*/gi, "").replace(/\s*seed:demo\s*/gi, " ").trim();
  if (!trimmed || trimmed === "seed:demo") return null;
  return trimmed;
}

export function isDemoSource(value: string | null | undefined): boolean {
  return (value ?? "").toLowerCase().includes("seed:demo");
}
