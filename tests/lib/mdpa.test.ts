import { describe, it, expect } from "vitest";
import { folioToStrap, parseAddressForGIS } from "../../lib/mdpa";

// ─── folioToStrap ─────────────────────────────────────────────────────────────

describe("folioToStrap", () => {
  it("formats a standard 13-digit folio", () => {
    expect(folioToStrap("0131250780010")).toBe("01-3125-078-0010");
  });

  it("formats a second known Miami-Dade folio", () => {
    // from lib/mdpa.ts JSDoc example
    expect(folioToStrap("0141370650001")).toBe("01-4137-065-0001");
  });

  it("pads a 12-digit folio with a leading zero", () => {
    // "131250780010" is 12 chars — padStart(13, "0") gives "0131250780010"
    expect(folioToStrap("131250780010")).toBe("01-3125-078-0010");
  });

  it("pads a short folio all the way to 13 digits", () => {
    expect(folioToStrap("1")).toBe("00-0000-000-0001");
  });

  it("handles all-zeros folio", () => {
    expect(folioToStrap("0000000000000")).toBe("00-0000-000-0000");
  });

  it("handles all-nines folio", () => {
    expect(folioToStrap("9999999999999")).toBe("99-9999-999-9999");
  });

  it("formats a Doral-area industrial folio (section 30)", () => {
    expect(folioToStrap("3040150110010")).toBe("30-4015-011-0010");
  });
});

// ─── parseAddressForGIS ───────────────────────────────────────────────────────

describe("parseAddressForGIS", () => {
  // ── Happy path ─────────────────────────────────────────────────────────────

  it("extracts house number and first non-dir/non-type keyword", () => {
    expect(parseAddressForGIS("200 S Biscayne Blvd")).toEqual({
      houseNum: 200,
      streetKeyword: "BISCAYNE",
    });
  });

  it("strips everything after the first comma (city / state / zip)", () => {
    expect(parseAddressForGIS("200 S Biscayne Blvd, Miami FL 33131")).toEqual({
      houseNum: 200,
      streetKeyword: "BISCAYNE",
    });
  });

  it("is case-insensitive — lowercased input parses correctly", () => {
    expect(parseAddressForGIS("1221 brickell ave")).toEqual({
      houseNum: 1221,
      streetKeyword: "BRICKELL",
    });
  });

  it("handles all eight directional prefixes (N S E W NE NW SE SW)", () => {
    for (const dir of ["N", "S", "E", "W", "NE", "NW", "SE", "SW"]) {
      const result = parseAddressForGIS(`100 ${dir} Miami Ave`);
      expect(result, `direction ${dir}`).toEqual({ houseNum: 100, streetKeyword: "MIAMI" });
    }
  });

  it("skips directionals that appear after the street name", () => {
    // "500 Brickell Ave SW" — SW at end is still filtered
    expect(parseAddressForGIS("500 Brickell Ave SW")).toEqual({
      houseNum: 500,
      streetKeyword: "BRICKELL",
    });
  });

  it("returns first non-dir/non-type word when suite indicator appears mid-string", () => {
    // APT is not in DIRS or TYPES, but BRICKELL comes first so it's the keyword
    expect(parseAddressForGIS("1221 Brickell Ave Apt 4B, Miami FL")).toEqual({
      houseNum: 1221,
      streetKeyword: "BRICKELL",
    });
  });

  it("uses named street number (≥2 digits) as keyword when no word name present", () => {
    // "3401 NW 12 Ave" — only non-dir/non-type token is "12" (length 2 → valid)
    expect(parseAddressForGIS("3401 NW 12 Ave")).toEqual({
      houseNum: 3401,
      streetKeyword: "12",
    });
  });

  it("strips non-alphanumeric chars from the keyword", () => {
    // "200 NW 42nd St" — "42ND" has no non-alnum chars, passes through
    expect(parseAddressForGIS("200 NW 42nd Ave")).toEqual({
      houseNum: 200,
      streetKeyword: "42ND",
    });
  });

  it("handles extra internal whitespace in input", () => {
    expect(parseAddressForGIS("200   S   Biscayne   Blvd")).toEqual({
      houseNum: 200,
      streetKeyword: "BISCAYNE",
    });
  });

  it("uses the mdpa.ts JSDoc example address correctly", () => {
    expect(parseAddressForGIS("3401 N Miami Ave")).toEqual({
      houseNum: 3401,
      streetKeyword: "MIAMI",
    });
  });

  // ── Null cases ─────────────────────────────────────────────────────────────

  it("returns null when input has no leading house number", () => {
    expect(parseAddressForGIS("Biscayne Blvd")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseAddressForGIS("")).toBeNull();
  });

  it("returns null when every word is a directional or type suffix", () => {
    // "100 N ST" → rest = "N ST", both filtered → words = []
    expect(parseAddressForGIS("100 N ST")).toBeNull();
  });

  it("returns null when the only keyword is a single digit (< 2 chars)", () => {
    // "3401 NW 2 Ave" → keyword "2", length 1 < 2 → null
    expect(parseAddressForGIS("3401 NW 2 Ave")).toBeNull();
  });

  it("returns null for '111 NW 1 ST' — the broken PA proxy default address", () => {
    // "1 ST" → keyword "1", length 1 < 2 → null
    // This is the infamous bad address; the GIS lookup correctly rejects it.
    expect(parseAddressForGIS("111 NW 1 ST")).toBeNull();
  });

  it("returns null for a single-digit named street with directional", () => {
    // Miami's "1 SE 3 Ave" pattern — "3" is length 1 < 2
    expect(parseAddressForGIS("1 SE 3 Ave")).toBeNull();
  });
});
