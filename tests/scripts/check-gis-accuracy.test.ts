import { describe, expect, it } from "vitest";
import {
  normalizeFolio,
  parseLabeledCsv,
} from "../../scripts/check-gis-accuracy";

describe("normalizeFolio", () => {
  it("strips dashes and pads to 13 digits", () => {
    expect(normalizeFolio("01-3125-078-0010")).toBe("0131250780010");
  });

  it("accepts already-undashed 13-digit folio", () => {
    expect(normalizeFolio("0131250780010")).toBe("0131250780010");
  });

  it("pads short numeric input", () => {
    expect(normalizeFolio("131250780010")).toBe("0131250780010");
  });
});

describe("parseLabeledCsv", () => {
  it("parses header + rows with optional owner", () => {
    const csv = [
      "address,expected_owner,expected_folio",
      "200 S Biscayne Blvd,BAYSIDE TOWER LLC,01-0203-010-0010",
      '"1221 Brickell Ave, Suite 200",ACME LLC,01-0203-010-0020',
    ].join("\n");

    const rows = parseLabeledCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      address: "200 S Biscayne Blvd",
      expectedOwner: "BAYSIDE TOWER LLC",
      expectedFolio: "0102030100010",
    });
    expect(rows[1].address).toBe("1221 Brickell Ave, Suite 200");
    expect(rows[1].expectedOwner).toBe("ACME LLC");
  });

  it("allows omitting expected_owner column", () => {
    const csv = ["address,expected_folio", "100 Brickell Ave,01-0203-010-0010"].join("\n");
    const rows = parseLabeledCsv(csv);
    expect(rows[0].expectedOwner).toBeNull();
    expect(rows[0].expectedFolio).toBe("0102030100010");
  });

  it("throws when required columns are missing", () => {
    expect(() => parseLabeledCsv("foo,bar\n1,2")).toThrow(/address.*expected_folio/i);
  });

  it("throws when there is no data row", () => {
    expect(() =>
      parseLabeledCsv("address,expected_owner,expected_folio")
    ).toThrow(/header row and at least one data row/i);
  });
});
