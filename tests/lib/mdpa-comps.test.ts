import { describe, expect, it } from "vitest";
import {
  dorMajorClass,
  extractLatestSale,
  extractLotSize,
  folioFromMdpaSourceUrl,
  isSaleRecent,
  normalizeSaleDate,
  pricePerAcre,
  rankCompCandidates,
  sameDorClass,
} from "../../lib/mdpa-comps";

describe("extractLotSize", () => {
  it("reads PropertyInfo.LotSize", () => {
    expect(extractLotSize({ PropertyInfo: { LotSize: 225561 } })).toBe(225561);
  });

  it("returns null when LotSize is absent, zero, or unparseable", () => {
    expect(extractLotSize({ PropertyInfo: {} })).toBeNull();
    expect(extractLotSize({ PropertyInfo: { LotSize: 0 } })).toBeNull();
    expect(extractLotSize({ PropertyInfo: { LotSize: "n/a" } })).toBeNull();
    expect(extractLotSize({})).toBeNull();
  });
});

describe("pricePerAcre", () => {
  it("computes sale price per acre for a land-heavy comp", () => {
    // 225,561 sf (5.178 acres) sold for $5,280,000 -> ~$1.02M/acre
    expect(pricePerAcre(5_280_000, 225_561)).toBeCloseTo(1_019_666, -1);
  });

  it("returns null when either input is missing or land size is zero", () => {
    expect(pricePerAcre(null, 225_561)).toBeNull();
    expect(pricePerAcre(5_280_000, null)).toBeNull();
    expect(pricePerAcre(5_280_000, 0)).toBeNull();
  });
});

describe("normalizeSaleDate", () => {
  it("parses US and ISO dates", () => {
    expect(normalizeSaleDate("9/12/2024")).toBe("2024-09-12");
    expect(normalizeSaleDate("2024-09-12")).toBe("2024-09-12");
  });

  it("returns null for empty", () => {
    expect(normalizeSaleDate("")).toBeNull();
  });
});

describe("extractLatestSale", () => {
  it("picks newest SalesInfos row", () => {
    const sale = extractLatestSale({
      SalesInfos: [
        { DateOfSale: "1/1/2010", SalePrice: 100, QualifiedFlag: "Q" },
        { DateOfSale: "9/12/2024", SalePrice: 83750000, QualifiedFlag: "Q" },
      ],
    });
    expect(sale).toEqual({
      saleDate: "2024-09-12",
      salePrice: 83750000,
      qualified: true,
    });
  });

  it("returns null when no sales", () => {
    expect(extractLatestSale({ SalesInfos: [] })).toBeNull();
    expect(extractLatestSale({})).toBeNull();
  });
});

describe("dor helpers", () => {
  it("extracts major class and matches", () => {
    expect(dorMajorClass("1517")).toBe("15");
    expect(sameDorClass("1517", "1511")).toBe(true);
    expect(sameDorClass("1517", "4011")).toBe(false);
  });
});

describe("isSaleRecent", () => {
  it("accepts recent dates", () => {
    const year = new Date().getFullYear() - 2;
    expect(isSaleRecent(`${year}-06-01`, 7)).toBe(true);
    expect(isSaleRecent("1990-01-01", 7)).toBe(false);
  });
});

describe("rankCompCandidates", () => {
  it("dedupes and prefers exact DOR then class", () => {
    const ranked = rankCompCandidates("1517", [
      { FOLIO: "1", DOR_CODE_CUR: "4011", BUILDING_ACTUAL_AREA: 50000 },
      { FOLIO: "2", DOR_CODE_CUR: "1511", BUILDING_ACTUAL_AREA: 10000 },
      { FOLIO: "3", DOR_CODE_CUR: "1517", BUILDING_ACTUAL_AREA: 8000 },
      { FOLIO: "2", DOR_CODE_CUR: "1511", BUILDING_ACTUAL_AREA: 10000 },
    ]);
    expect(ranked.map((r) => r.FOLIO)).toEqual([
      "0000000000003",
      "0000000000002",
      "0000000000001",
    ]);
  });
});

describe("folioFromMdpaSourceUrl", () => {
  it("parses dashed and undashed mdpa refs", () => {
    expect(folioFromMdpaSourceUrl("mdpa:01-3125-078-0010")).toBe("0131250780010");
    expect(folioFromMdpaSourceUrl("mdpa:0131250780010")).toBe("0131250780010");
    expect(folioFromMdpaSourceUrl("https://example.com")).toBeNull();
  });
});
