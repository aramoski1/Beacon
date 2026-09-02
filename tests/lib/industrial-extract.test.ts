import { describe, expect, it } from "vitest";
import {
  compactIndustrial,
  industrialFromCustomFields,
  industrialFromExtracted,
  mergeIndustrialDisplay,
  parseNumericSpec,
  yardAcresFromLandSqft,
} from "@/lib/industrial-extract";

describe("parseNumericSpec", () => {
  it("reads a number from strings like 24 ft", () => {
    expect(parseNumericSpec("24 ft")).toBe(24);
    expect(parseNumericSpec("$16.50")).toBe(16.5);
    expect(parseNumericSpec("6")).toBe(6);
    expect(parseNumericSpec(32)).toBe(32);
    expect(parseNumericSpec(null)).toBeNull();
    expect(parseNumericSpec("none")).toBeNull();
  });
});

describe("yardAcresFromLandSqft", () => {
  it("converts lot SF to acres", () => {
    expect(yardAcresFromLandSqft(43_560)).toBe(1);
    expect(yardAcresFromLandSqft(217_800)).toBe(5);
    expect(yardAcresFromLandSqft(null)).toBeNull();
  });
});

describe("industrialFromExtracted", () => {
  it("maps first-class extract fields", () => {
    const out = industrialFromExtracted({
      clear_height_ft: 24,
      dock_doors: 8,
      power_phase: "3-phase",
      sprinkler_type: "ESFR",
      lease_structure: "NNN",
    });
    expect(out.clear_height_ft).toBe(24);
    expect(out.dock_doors).toBe(8);
    expect(out.power_phase).toBe("3");
    expect(out.sprinkler_type).toBe("esfr");
    expect(out.lease_structure).toBe("nnn");
  });

  it("lifts custom_fields slugs used by older extract-mode fields", () => {
    const out = industrialFromExtracted({
      custom_fields: { clear_height: "24 ft", dock_doors: "6" },
    });
    expect(out.clear_height_ft).toBe(24);
    expect(out.dock_doors).toBe(6);
  });

  it("does not invent yard acres from lot SF — that is county-only persistence", () => {
    const out = industrialFromExtracted({
      building_composition: { lot_size_sqft: 87_120 },
    });
    expect(out.yard_acres).toBeNull();
  });
});

describe("mergeIndustrialDisplay", () => {
  it("prefers stored columns over custom_fields", () => {
    const out = mergeIndustrialDisplay(
      { dock_doors: 4 },
      { dock_doors: "99" },
    );
    expect(out.dock_doors).toBe(4);
  });

  it("fills empty columns from custom_fields", () => {
    const out = mergeIndustrialDisplay(
      { dock_doors: null },
      { clear_height: "32" },
    );
    expect(out.clear_height_ft).toBe(32);
  });
});

describe("compactIndustrial", () => {
  it("omits nulls so an update does not wipe unspecified columns", () => {
    const compact = compactIndustrial(industrialFromExtracted({ dock_doors: 2 }));
    expect(compact).toEqual({ dock_doors: 2 });
  });
});

describe("industrialFromCustomFields", () => {
  it("is a convenience wrapper around extracted custom_fields", () => {
    expect(industrialFromCustomFields({ asking_rent: 18.5 }).asking_rent_psf).toBe(18.5);
  });
});
