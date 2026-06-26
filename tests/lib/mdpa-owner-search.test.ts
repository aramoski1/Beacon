import { describe, expect, it } from "vitest";
import { entityOwnerNamesMatch } from "../../lib/mdpa-owner-search";

describe("entityOwnerNamesMatch", () => {
  it("matches exact normalized names", () => {
    expect(entityOwnerNamesMatch("Acme Holdings LLC", "ACME HOLDINGS LLC")).toBe(true);
  });

  it("matches when tax roll adds state suffix", () => {
    expect(entityOwnerNamesMatch("Acme Holdings LLC", "ACME HOLDINGS LLC A FL")).toBe(true);
  });

  it("matches punctuation variants", () => {
    expect(entityOwnerNamesMatch("A.B.C. Industrial LLC", "ABC INDUSTRIAL LLC")).toBe(true);
  });

  it("matches when core name is contained", () => {
    expect(entityOwnerNamesMatch("Publix Super Markets Inc", "PUBLIX SUPER MARKETS INC")).toBe(true);
  });

  it("does not match unrelated entities sharing one token", () => {
    expect(entityOwnerNamesMatch("Acme Holdings LLC", "Beta Acme Partners LLC")).toBe(false);
  });
});
