import { describe, it, expect } from "vitest";
import {
  requireLinkedPropertyId,
  matchPropertyByAddress,
  LEASE_PROPERTY_REQUIRED_MSG,
} from "../../lib/lease-property";

describe("requireLinkedPropertyId", () => {
  it("rejects null", () => {
    expect(requireLinkedPropertyId(null)).toBe(LEASE_PROPERTY_REQUIRED_MSG);
  });

  it("rejects undefined", () => {
    expect(requireLinkedPropertyId(undefined)).toBe(LEASE_PROPERTY_REQUIRED_MSG);
  });

  it("rejects empty / whitespace", () => {
    expect(requireLinkedPropertyId("")).toBe(LEASE_PROPERTY_REQUIRED_MSG);
    expect(requireLinkedPropertyId("   ")).toBe(LEASE_PROPERTY_REQUIRED_MSG);
  });

  it("accepts a non-empty property id", () => {
    expect(requireLinkedPropertyId("abc-123")).toBeNull();
  });
});

describe("matchPropertyByAddress", () => {
  const props = [
    { id: "1", address: "200 W Broward Blvd", city: "Fort Lauderdale" },
    { id: "2", address: "2116 Sherman St", city: "Hollywood" },
    { id: "3", address: "100 Brickell Ave", city: "Miami" },
  ];

  it("returns null for empty premises", () => {
    expect(matchPropertyByAddress(props, null)).toBeNull();
    expect(matchPropertyByAddress(props, "")).toBeNull();
  });

  it("returns null when book is empty", () => {
    expect(matchPropertyByAddress([], "2116 Sherman St")).toBeNull();
  });

  it("matches exact address case-insensitively", () => {
    expect(matchPropertyByAddress(props, "2116 SHERMAN ST")?.id).toBe("2");
  });

  it("matches when premises contains the book address", () => {
    expect(matchPropertyByAddress(props, "2116 Sherman St, Hollywood, FL")?.id).toBe("2");
  });

  it("matches when book address contains the premises fragment", () => {
    expect(matchPropertyByAddress(props, "200 W Broward")?.id).toBe("1");
  });
});
