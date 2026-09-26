/**
 * Lease comps from the broker's own abstracts — not CoStar.
 * Bands by submarket, property_type, and building SF (±tolerance).
 */

export type LeaseCompCandidate = {
  leaseId: string;
  propertyId: string;
  address: string | null;
  submarket: string | null;
  propertyType: string | null;
  sizeSqft: number | null;
  baseRate: number | null;
  term: string | null;
  expirationDate: string | null;
  /** Exclude the subject property's own abstracts from comps. */
  isSubjectProperty: boolean;
};

export type LeaseComp = {
  leaseId: string;
  propertyId: string;
  address: string | null;
  submarket: string | null;
  propertyType: string | null;
  sizeSqft: number | null;
  baseRate: number | null;
  term: string | null;
  expirationDate: string | null;
  sameSubmarket: boolean;
  sameType: boolean;
  withinSfBand: boolean;
};

export type LeaseCompsBand = {
  subjectSubmarket: string | null;
  subjectType: string | null;
  subjectSqft: number | null;
  /** Fraction of SF allowed above/below subject (default 0.35 = ±35%). */
  sfTolerance: number;
};

export function normalizeBandKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** True when candidate SF is within ±tolerance of subject SF. Missing SF = not in band. */
export function withinSfBand(
  subjectSqft: number | null,
  candidateSqft: number | null,
  tolerance = 0.35,
): boolean {
  if (subjectSqft == null || subjectSqft <= 0) return false;
  if (candidateSqft == null || candidateSqft <= 0) return false;
  const lo = subjectSqft * (1 - tolerance);
  const hi = subjectSqft * (1 + tolerance);
  return candidateSqft >= lo && candidateSqft <= hi;
}

export function scoreLeaseComp(
  c: {
    sameSubmarket: boolean;
    sameType: boolean;
    withinSfBand: boolean;
    baseRate: number | null;
  },
): number {
  let score = 0;
  if (c.sameSubmarket) score += 40;
  if (c.sameType) score += 30;
  if (c.withinSfBand) score += 20;
  if (c.baseRate != null && c.baseRate > 0) score += 10;
  return score;
}

/**
 * Select lease comps from candidates for a subject property band.
 * Requires at least submarket OR type match (plus prefer SF band); drops subject property leases.
 */
export function selectLeaseComps(
  candidates: LeaseCompCandidate[],
  band: LeaseCompsBand,
  limit = 8,
): LeaseComp[] {
  const sub = normalizeBandKey(band.subjectSubmarket);
  const typ = normalizeBandKey(band.subjectType);
  const tol = band.sfTolerance ?? 0.35;

  const rows: LeaseComp[] = [];
  for (const c of candidates) {
    if (c.isSubjectProperty) continue;
    if (c.baseRate == null || !(c.baseRate > 0)) continue;

    const sameSubmarket =
      !!sub && normalizeBandKey(c.submarket) === sub;
    const sameType =
      !!typ && normalizeBandKey(c.propertyType) === typ;
    const inSf = withinSfBand(band.subjectSqft, c.sizeSqft, tol);

    // Need at least a submarket or type match to qualify. SF proximity alone
    // is not enough to call two leases comps — e.g. a residential unit that
    // happens to be near an industrial subject's square footage is not a
    // real comp for it. SF band is used only as a scoring/sort preference
    // below (scoreLeaseComp, tie-break by closeness), never as the sole
    // qualifying signal.
    if (!sameSubmarket && !sameType) continue;

    rows.push({
      leaseId: c.leaseId,
      propertyId: c.propertyId,
      address: c.address,
      submarket: c.submarket,
      propertyType: c.propertyType,
      sizeSqft: c.sizeSqft,
      baseRate: c.baseRate,
      term: c.term,
      expirationDate: c.expirationDate,
      sameSubmarket,
      sameType,
      withinSfBand: inSf,
    });
  }

  const typed = typ ? rows.filter((r) => r.sameType) : [];
  const pool = typed.length >= 2 ? typed : rows;

  pool.sort((a, b) => {
    const ds = scoreLeaseComp(b) - scoreLeaseComp(a);
    if (ds !== 0) return ds;
    // Prefer closer SF when both have size
    if (band.subjectSqft && a.sizeSqft && b.sizeSqft) {
      return (
        Math.abs(a.sizeSqft - band.subjectSqft) -
        Math.abs(b.sizeSqft - band.subjectSqft)
      );
    }
    return (a.address ?? "").localeCompare(b.address ?? "");
  });

  return pool.slice(0, limit);
}

export function leaseCompsEmptyCopy(hasAnyAbstractsInBook: boolean): string {
  if (!hasAnyAbstractsInBook) {
    return "No lease abstracts in this band yet — abstract more leases to unlock comps.";
  }
  return "No lease abstracts in this band yet — abstract more leases to unlock comps.";
}
