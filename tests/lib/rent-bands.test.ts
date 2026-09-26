import { describe, expect, it } from "vitest";
import { lookupRentBand } from "../../lib/submarket-rent-bands";

describe("lookupRentBand aliases", () => {
  it("matches Doral and Homestead nicknames", () => {
    expect(lookupRentBand("Doral")?.submarket).toBe("Airport West / Doral");
    expect(lookupRentBand("Homestead")?.submarket).toBe("South Dade / Homestead");
    expect(lookupRentBand("Pembroke Pines")?.submarket).toBe("Miramar / Pembroke");
  });
});
