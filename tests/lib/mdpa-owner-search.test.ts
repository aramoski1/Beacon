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

  // Regression: real Broward/Miami-Dade tax roll owner names that used to
  // false-positive via the old order-independent token-overlap fallback.
  // Real-estate LLCs routinely share a single generic or geographic word
  // ("Paradise", "Holdings", "Miami", "West Brickell") with entities that
  // have nothing to do with each other.
  it("does not match unrelated entities sharing one generic real-estate word", () => {
    expect(entityOwnerNamesMatch("PARADISE 2 LLC", "OCEAN RIDGE PARADISE 120 LLC")).toBe(false);
    expect(entityOwnerNamesMatch("PARADISE LLC", "OCEAN RIDGE PARADISE 120 LLC")).toBe(false);
    expect(entityOwnerNamesMatch("T & D HOLDINGS LLC", "GGW HOLDINGS LLC")).toBe(false);
  });

  it("does not match unrelated entities sharing two generic/geographic words", () => {
    expect(entityOwnerNamesMatch("OCEAN PARADISE LLC", "OCEAN RIDGE PARADISE 120 LLC")).toBe(false);
    expect(entityOwnerNamesMatch("WEST BRICKELL INVESTMENTS 2 LLC", "444 WEST BRICKELL LLC")).toBe(false);
  });

  it("does not match unrelated entities sharing only a city name", () => {
    expect(entityOwnerNamesMatch("MIAMI PROPERTY TRUST LLC", "HATZLACHA MIAMI LLC")).toBe(false);
  });

  it("matches a numbered sister entity via contiguous prefix", () => {
    expect(entityOwnerNamesMatch("ALVINTER PROPERTIES LLC", "ALVINTER PROPERTIES 108 LLC")).toBe(true);
  });
});
