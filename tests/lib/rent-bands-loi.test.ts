import { describe, expect, it } from "vitest";
import { formatRentBand, lookupRentBand } from "@/lib/submarket-rent-bands";
import { loiFileName } from "@/lib/loi-template";

describe("lookupRentBand", () => {
  it("matches Doral / Airport West", () => {
    const band = lookupRentBand("Doral");
    expect(band).not.toBeNull();
    expect(formatRentBand(band!)).toContain("NNN/SF");
  });

  it("returns null for an unknown submarket", () => {
    expect(lookupRentBand("Timbuktu")).toBeNull();
    expect(lookupRentBand(null)).toBeNull();
  });
});

describe("loiFileName", () => {
  it("slugs the deal name", () => {
    expect(loiFileName("Acme / 12000 NW 25th")).toMatch(/^LOI-Acme-12000-NW-25th\.docx$/i);
  });
});
