import { describe, expect, it } from "vitest";
import {
  hasFieldValue,
  isAuthoritativeFilled,
  isFieldLocked,
  isLocked,
  isProtectedFromAutoWrite,
  mergeFillOnly,
  tagManualIndustrial,
} from "@/lib/field-lock";

describe("isLocked", () => {
  it("locks county, manual, and sunbiz tags", () => {
    expect(isLocked({ dock_doors: "county" }, "dock_doors")).toBe(true);
    expect(isLocked({ dock_doors: "manual" }, "dock_doors")).toBe(true);
    expect(isLocked({ dock_doors: "sunbiz" }, "dock_doors")).toBe(true);
  });

  it("does not lock web, document, or untagged keys", () => {
    expect(isLocked({ dock_doors: "web" }, "dock_doors")).toBe(false);
    expect(isLocked({ dock_doors: "document" }, "dock_doors")).toBe(false);
    expect(isLocked({}, "dock_doors")).toBe(false);
    expect(isLocked(null, "dock_doors")).toBe(false);
  });
});

describe("isFieldLocked", () => {
  it("treats the paired industrial column as locked when the custom slug is", () => {
    expect(isFieldLocked({ "custom_fields.dock_doors": "manual" }, "dock_doors")).toBe(true);
  });

  it("treats the custom slug as locked when the column is", () => {
    expect(isFieldLocked({ dock_doors: "county" }, "custom_fields.dock_doors")).toBe(true);
  });
});

describe("isAuthoritativeFilled / isProtectedFromAutoWrite", () => {
  it("protects a filled county scalar even without a tag", () => {
    expect(isAuthoritativeFilled("owner_name", "Acme LLC")).toBe(true);
    expect(isProtectedFromAutoWrite({}, "owner_name", "Acme LLC")).toBe(true);
  });

  it("does not protect an empty authoritative field", () => {
    expect(isAuthoritativeFilled("owner_name", null)).toBe(false);
    expect(isProtectedFromAutoWrite({}, "owner_name", null)).toBe(false);
  });

  it("protects a locked industrial spec even when empty", () => {
    expect(isProtectedFromAutoWrite({ dock_doors: "manual" }, "dock_doors", null)).toBe(true);
  });
});

describe("mergeFillOnly", () => {
  it("fills empty unlocked fields and tags the writer", () => {
    const { next, written, nextSources } = mergeFillOnly(
      { dock_doors: null, clear_height_ft: 24 },
      { dock_doors: 8, clear_height_ft: 32 },
      {},
      "web",
    );
    expect(next.dock_doors).toBe(8);
    expect(next.clear_height_ft).toBe(24);
    expect(written).toEqual(["dock_doors"]);
    expect(nextSources.dock_doors).toBe("web");
    expect(nextSources.clear_height_ft).toBeUndefined();
  });

  it("never overwrites a locked tag even when incoming disagrees", () => {
    const { next, written } = mergeFillOnly(
      { dock_doors: 4 },
      { dock_doors: 12 },
      { dock_doors: "county" },
      "web",
    );
    expect(next.dock_doors).toBe(4);
    expect(written).toEqual([]);
  });

  it("never overwrites a filled authoritative scalar", () => {
    const { next, written } = mergeFillOnly(
      { owner_name: "Tax Roll LLC" },
      { owner_name: "Listing Owner LLC" },
      {},
      "web",
    );
    expect(next.owner_name).toBe("Tax Roll LLC");
    expect(written).toEqual([]);
  });

  it("skips null incoming so empty stays empty", () => {
    const { written } = mergeFillOnly({ dock_doors: null }, { dock_doors: null }, {}, "web");
    expect(written).toEqual([]);
  });
});

describe("tagManualIndustrial", () => {
  it("tags both the custom slug and the first-class column", () => {
    const next = tagManualIndustrial({}, "dock_doors");
    expect(next["custom_fields.dock_doors"]).toBe("manual");
    expect(next.dock_doors).toBe("manual");
  });
});

describe("hasFieldValue", () => {
  it("treats null and empty string as empty", () => {
    expect(hasFieldValue(null)).toBe(false);
    expect(hasFieldValue("")).toBe(false);
    expect(hasFieldValue(0)).toBe(true);
    expect(hasFieldValue("ESFR")).toBe(true);
  });
});
