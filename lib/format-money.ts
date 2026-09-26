export function formatPsf(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `$${Number(n).toFixed(2)}/sf`;
}

export function roundPsf(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}
