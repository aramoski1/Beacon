import { describe, it, expect } from "vitest";
import {
  ALL_MODULE_IDS,
  DEFAULT_VISIBLE,
  isModuleId,
  resolveVisible,
  sanitizeVisiblePatch,
  MODULE_GROUPS,
  MODULE_LABELS,
} from "../../lib/dashboard-layout";

describe("DEFAULT_VISIBLE", () => {
  it("has every catalog module id set to true", () => {
    for (const id of ALL_MODULE_IDS) {
      expect(DEFAULT_VISIBLE[id]).toBe(true);
    }
  });
});

describe("isModuleId", () => {
  it("accepts every real catalog id", () => {
    for (const id of ALL_MODULE_IDS) {
      expect(isModuleId(id)).toBe(true);
    }
  });

  it("rejects unknown ids, including hero/copilot (never in the catalog)", () => {
    expect(isModuleId("hero")).toBe(false);
    expect(isModuleId("beacon_copilot")).toBe(false);
    expect(isModuleId("kpi_made_up")).toBe(false);
    expect(isModuleId("")).toBe(false);
  });
});

describe("resolveVisible", () => {
  it("treats null prefs as everything visible — matches today's fixed layout", () => {
    const result = resolveVisible(null);
    for (const id of ALL_MODULE_IDS) {
      expect(result[id]).toBe(true);
    }
  });

  it("treats undefined prefs the same as null", () => {
    const result = resolveVisible(undefined);
    for (const id of ALL_MODULE_IDS) {
      expect(result[id]).toBe(true);
    }
  });

  it("treats a prefs object with an empty visible map as everything visible", () => {
    const result = resolveVisible({ version: 1, visible: {} });
    for (const id of ALL_MODULE_IDS) {
      expect(result[id]).toBe(true);
    }
  });

  it("missing keys in a partial map resolve to true (default-on for modules added after a broker's last save)", () => {
    const result = resolveVisible({ version: 1, visible: { pipeline: false } });
    expect(result.pipeline).toBe(false);
    expect(result.kpi_book).toBe(true);
    expect(result.today_desk).toBe(true);
  });

  it("respects explicit false for multiple modules across groups", () => {
    const result = resolveVisible({
      version: 1,
      visible: { kpi_book: false, week_momentum: false, pipeline: false },
    });
    expect(result.kpi_book).toBe(false);
    expect(result.week_momentum).toBe(false);
    expect(result.pipeline).toBe(false);
    // everything else still on
    expect(result.kpi_pursuits).toBe(true);
    expect(result.today_desk).toBe(true);
    expect(result.lease_exposure).toBe(true);
  });

  it("ignores a non-boolean value at a key rather than throwing", () => {
    const result = resolveVisible({
      version: 1,
      // @ts-expect-error — deliberately malformed to prove resolveVisible doesn't crash
      visible: { pipeline: "false" },
    });
    expect(result.pipeline).toBe(true);
  });
});

describe("sanitizeVisiblePatch", () => {
  it("accepts a valid partial patch", () => {
    const res = sanitizeVisiblePatch({ pipeline: false, kpi_book: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visible).toEqual({ pipeline: false, kpi_book: true });
  });

  it("rejects an unknown module id", () => {
    const res = sanitizeVisiblePatch({ pipeline: false, made_up_widget: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("made_up_widget");
  });

  it("rejects hero/copilot ids specifically, since they were never in the catalog", () => {
    const res = sanitizeVisiblePatch({ hero: false });
    expect(res.ok).toBe(false);
  });

  it("rejects a non-boolean value", () => {
    const res = sanitizeVisiblePatch({ pipeline: "off" });
    expect(res.ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(sanitizeVisiblePatch(null).ok).toBe(false);
    expect(sanitizeVisiblePatch("nope").ok).toBe(false);
    expect(sanitizeVisiblePatch([1, 2, 3]).ok).toBe(false);
  });

  it("accepts an empty object (no-op patch)", () => {
    const res = sanitizeVisiblePatch({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visible).toEqual({});
  });
});

describe("MODULE_GROUPS / MODULE_LABELS", () => {
  it("every catalog id appears in exactly one group", () => {
    const seen = new Set<string>();
    for (const group of MODULE_GROUPS) {
      for (const id of group.moduleIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(ALL_MODULE_IDS.length);
  });

  it("every catalog id has a human-readable label", () => {
    for (const id of ALL_MODULE_IDS) {
      expect(MODULE_LABELS[id]).toBeTruthy();
    }
  });
});
