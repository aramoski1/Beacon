import { describe, expect, it } from "vitest";
import {
  leaseCompsEmptyCopy,
  normalizeBandKey,
  scoreLeaseComp,
  selectLeaseComps,
  withinSfBand,
  type LeaseCompCandidate,
} from "../../lib/lease-comps";

describe("withinSfBand", () => {
  it("allows ±35% by default", () => {
    expect(withinSfBand(100_000, 100_000)).toBe(true);
    expect(withinSfBand(100_000, 65_000)).toBe(true);
    expect(withinSfBand(100_000, 135_000)).toBe(true);
    expect(withinSfBand(100_000, 50_000)).toBe(false);
    expect(withinSfBand(null, 100_000)).toBe(false);
  });
});

describe("selectLeaseComps", () => {
  const band = {
    subjectSubmarket: "Doral",
    subjectType: "Industrial",
    subjectSqft: 80_000,
    sfTolerance: 0.35,
  };

  const candidates: LeaseCompCandidate[] = [
    {
      leaseId: "self",
      propertyId: "subj",
      address: "Subject",
      submarket: "Doral",
      propertyType: "Industrial",
      sizeSqft: 80_000,
      baseRate: 12,
      term: "5 years",
      expirationDate: "2028-01-01",
      isSubjectProperty: true,
    },
    {
      leaseId: "l1",
      propertyId: "p1",
      address: "100 Peer Way",
      submarket: "Doral",
      propertyType: "Industrial",
      sizeSqft: 90_000,
      baseRate: 14.5,
      term: "7 years",
      expirationDate: "2029-06-01",
      isSubjectProperty: false,
    },
    {
      leaseId: "l2",
      propertyId: "p2",
      address: "Far Office",
      submarket: "Brickell",
      propertyType: "Office",
      sizeSqft: 10_000,
      baseRate: 45,
      term: "3 years",
      expirationDate: null,
      isSubjectProperty: false,
    },
    {
      leaseId: "l3",
      propertyId: "p3",
      address: "No rate",
      submarket: "Doral",
      propertyType: "Industrial",
      sizeSqft: 85_000,
      baseRate: null,
      term: null,
      expirationDate: null,
      isSubjectProperty: false,
    },
    // Same SF band as the subject, but a different submarket AND a
    // different property type — an SF-only coincidence, not a real comp
    // (e.g. a residential unit surfacing against an industrial subject).
    {
      leaseId: "l4",
      propertyId: "p4",
      address: "Unrelated Residential Unit",
      submarket: "Kendall",
      propertyType: "Residential",
      sizeSqft: 85_000,
      baseRate: 20,
      term: "1 year",
      expirationDate: null,
      isSubjectProperty: false,
    },
  ];

  it("ranks same submarket+type+SF and drops subject / no rate / unrelated", () => {
    const comps = selectLeaseComps(candidates, band, 8);
    expect(comps).toHaveLength(1);
    expect(comps[0]!.leaseId).toBe("l1");
    expect(comps[0]!.sameSubmarket).toBe(true);
    expect(comps[0]!.sameType).toBe(true);
    expect(comps[0]!.withinSfBand).toBe(true);
  });

  it("does not surface a comp that only matches on SF band with a different submarket and type", () => {
    const comps = selectLeaseComps(candidates, band, 8);
    expect(comps.some((c) => c.leaseId === "l4")).toBe(false);
  });

  it("SF-band-only match (no submarket or type match) is excluded entirely", () => {
    const sfOnlyCandidate: LeaseCompCandidate = {
      leaseId: "sf-only",
      propertyId: "p5",
      address: "SF Coincidence",
      submarket: "Kendall",
      propertyType: "Residential",
      sizeSqft: 80_000,
      baseRate: 18,
      term: "2 years",
      expirationDate: null,
      isSubjectProperty: false,
    };
    const comps = selectLeaseComps([sfOnlyCandidate], band, 8);
    expect(comps).toHaveLength(0);
  });

  it("normalizeBandKey trims case", () => {
    expect(normalizeBandKey("  Doral ")).toBe("doral");
    expect(normalizeBandKey("")).toBeNull();
  });

  it("scoreLeaseComp weights matches", () => {
    expect(
      scoreLeaseComp({
        sameSubmarket: true,
        sameType: true,
        withinSfBand: true,
        baseRate: 10,
      }),
    ).toBe(100);
  });

  it("empty copy is broker-honest", () => {
    expect(leaseCompsEmptyCopy(false)).toMatch(/abstract more leases/i);
  });
});
