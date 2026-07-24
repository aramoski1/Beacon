import { describe, expect, it } from "vitest";
import { personNameMatchesOwnerField } from "../../lib/owner-contacts";

describe("personNameMatchesOwnerField", () => {
  it("matches exact and reordered tokens", () => {
    expect(personNameMatchesOwnerField("Vara Adalberto", "VARA ADALBERTO")).toBe(true);
    expect(personNameMatchesOwnerField("Vara Adalberto", "ADALBERTO VARA")).toBe(true);
    expect(personNameMatchesOwnerField("Vara Adalberto", "Vara, Adalberto")).toBe(true);
  });

  it("matches when tax roll adds a middle name", () => {
    expect(personNameMatchesOwnerField("Vara Adalberto", "VARA ADALBERTO JOSE")).toBe(true);
  });

  it("does not match substring false positives", () => {
    // "vara" must not match inside "alvarado"
    expect(personNameMatchesOwnerField("Vara Adalberto", "ALVARADO ROBERTO")).toBe(false);
    expect(personNameMatchesOwnerField("Vara Adalberto", "VARADERO HOLDINGS LLC")).toBe(false);
    expect(personNameMatchesOwnerField("Vara Adalberto", "SMITH JOHN")).toBe(false);
  });

  it("does not match when only one token overlaps", () => {
    expect(personNameMatchesOwnerField("Vara Adalberto", "VARA MARIA")).toBe(false);
    expect(personNameMatchesOwnerField("Vara Adalberto", "ADALBERTO RUIZ")).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(personNameMatchesOwnerField("", "VARA ADALBERTO")).toBe(false);
    expect(personNameMatchesOwnerField("Vara Adalberto", "")).toBe(false);
  });
});
