import { describe, expect, it } from "vitest";
import {
  clearHeightFtFromText,
  industrialSpecsFromMdpa,
  industrialSpecsFromSketchHtml,
  yearBuiltFromBuildingInfos,
} from "@/lib/mdpa-industrial";
import { overlayMdpaOnExtracted } from "@/lib/mdpa";
import type { ExtractedProperty } from "@/lib/property-pipeline";

/** Live Medley warehouse extras — height factor is wall SF, not clear height. */
const MEDLEY_FOLIO = {
  RollYear1: 2026,
  PropertyInfo: {
    YearBuilt: "1976",
    FloorCount: 1,
    LotSize: 59692,
    BuildingActualArea: 37464,
    DORCode: "4132",
  },
  Building: {
    BuildingInfos: [
      { Actual: 1976, ActualArea: 34864, RollYear: 2026, improvementModelDesc: "Warehouse - CBS" },
    ],
  },
  ExtraFeature: {
    ExtraFeatureInfos: [
      { Description: "Interior Office - Good Quality", Units: 2600, RollYear: 2026 },
      { Description: "Height Factor - Wall Area Above 16 ft", Units: 1784, RollYear: 2026 },
      { Description: "Paving - Asphalt", Units: 16616, RollYear: 2026 },
      { Description: "Plumbing Fixtures - Warehouse", Units: 16, RollYear: 2026 },
    ],
  },
};

function extracted(over: Partial<ExtractedProperty> = {}): ExtractedProperty {
  return {
    address: "8205 NW 74 AVE",
    city: "Medley",
    submarket: null,
    owner_name: "FB MEDLEY LLC",
    ownership_type: "institutional",
    size_sqft: null,
    property_type: "industrial",
    last_sale_date: null,
    last_sale_price: null,
    building_composition: {},
    confidence_flags: [],
    ...over,
  };
}

describe("clearHeightFtFromText", () => {
  it("reads a stated clear height", () => {
    expect(clearHeightFtFromText("24 ft clear height")).toBe(24);
    expect(clearHeightFtFromText("clear height 28")).toBe(28);
  });

  it("ignores MDPA height-factor extras", () => {
    expect(clearHeightFtFromText("Height Factor - Wall Area Above 16 ft")).toBeNull();
  });
});

describe("industrialSpecsFromMdpa", () => {
  it("does not treat height-factor extras as clear height", () => {
    const specs = industrialSpecsFromMdpa(MEDLEY_FOLIO);
    expect(specs.clear_height_ft).toBeNull();
    expect(specs.dock_doors).toBeNull();
  });

  it("fills dock_doors from a named loading-dock extra with a count", () => {
    const specs = industrialSpecsFromMdpa({
      RollYear1: 2026,
      ExtraFeature: {
        ExtraFeatureInfos: [
          { Description: "Loading Dock", Units: 4, RollYear: 2026 },
        ],
      },
    });
    expect(specs.dock_doors).toBe(4);
  });

  it("does not treat paving or office SF as a door count", () => {
    const specs = industrialSpecsFromMdpa(MEDLEY_FOLIO);
    expect(specs.drive_in_doors).toBeNull();
    expect(specs.dock_doors).toBeNull();
  });
});

describe("industrialSpecsFromSketchHtml", () => {
  it("does not invent docks from WHS / OIG legend codes", () => {
    const html = `
      <table><tr><td>WHS : Warehouse</td><td>OIG : Office, Int Good</td></tr></table>
    `;
    const specs = industrialSpecsFromSketchHtml(html);
    expect(specs.dock_doors).toBeNull();
    expect(specs.clear_height_ft).toBeNull();
  });

  it("does not invent dock_doors from LPF without a count", () => {
    const specs = industrialSpecsFromSketchHtml("LPF : Loading Platform XHT : Extra Height");
    expect(specs.dock_doors).toBeNull();
    expect(specs.clear_height_ft).toBeNull();
  });

  it("copies a stated dock count from sketch text", () => {
    expect(industrialSpecsFromSketchHtml("8 dock doors and 32 ft clear").dock_doors).toBe(8);
    expect(industrialSpecsFromSketchHtml("8 dock doors and 32 ft clear").clear_height_ft).toBe(32);
  });
});

describe("yearBuiltFromBuildingInfos", () => {
  it("uses the earliest Actual year on the current roll", () => {
    expect(yearBuiltFromBuildingInfos({
      RollYear1: 2026,
      PropertyInfo: { YearBuilt: "Multiple (See Building Info.)" },
      Building: {
        BuildingInfos: [
          { Actual: 1948, RollYear: 2026 },
          { Actual: 1976, RollYear: 2026 },
          { Actual: 1990, RollYear: 2026 },
          { Actual: 1948, RollYear: 2025 },
        ],
      },
    })).toBe(1948);
  });
});

describe("overlayMdpaOnExtracted industrial + year", () => {
  it("does not overwrite a non-null extract spec", () => {
    const out = overlayMdpaOnExtracted(
      extracted({ dock_doors: 6 }),
      {
        RollYear1: 2026,
        ExtraFeature: { ExtraFeatureInfos: [{ Description: "Loading Dock", Units: 4, RollYear: 2026 }] },
      },
    );
    expect(out.dock_doors).toBe(6);
  });

  it("fills year_built from BuildingInfos when YearBuilt is Multiple", () => {
    const out = overlayMdpaOnExtracted(extracted(), {
      RollYear1: 2026,
      PropertyInfo: { YearBuilt: "Multiple (See Building Info.)", FloorCount: 4, BuildingActualArea: 82963 },
      Building: {
        BuildingInfos: [
          { Actual: 1948, RollYear: 2026 },
          { Actual: 1990, RollYear: 2026 },
        ],
      },
    });
    expect(out.building_composition.year_built).toBe(1948);
    expect(out.building_composition.stories).toBe(4);
    expect(out.size_sqft).toBe(82963);
  });

  it("fills empty dock_doors from extras", () => {
    const out = overlayMdpaOnExtracted(extracted(), {
      RollYear1: 2026,
      ExtraFeature: { ExtraFeatureInfos: [{ Description: "Loading Dock", Units: 4, RollYear: 2026 }] },
    });
    expect(out.dock_doors).toBe(4);
    expect(out.custom_fields?.dock_doors).toBe(4);
  });
});
