import { describe, expect, it } from "vitest";
import { resolveLinkedPropertyIds } from "../../lib/contact-properties";

describe("resolveLinkedPropertyIds", () => {
  it("prefers join-table ids over legacy array", () => {
    expect(resolveLinkedPropertyIds(["a", "b"], ["b", "c"])).toEqual(["a", "b"]);
  });

  it("falls back to legacy when join is empty", () => {
    expect(resolveLinkedPropertyIds([], ["x", "y"])).toEqual(["x", "y"]);
    expect(resolveLinkedPropertyIds(null, ["x"])).toEqual(["x"]);
  });

  it("returns empty when both missing", () => {
    expect(resolveLinkedPropertyIds(null, null)).toEqual([]);
    expect(resolveLinkedPropertyIds([], [])).toEqual([]);
  });

  it("dedupes", () => {
    expect(resolveLinkedPropertyIds(["a", "a"], null)).toEqual(["a"]);
  });

  it("auth-isolation: empty join + empty legacy never invents cross-user ids", () => {
    expect(resolveLinkedPropertyIds(undefined, undefined)).toEqual([]);
  });

  it("does not merge legacy when join has rows (join is source of truth)", () => {
    expect(resolveLinkedPropertyIds(["join-only"], ["legacy-extra"])).toEqual(["join-only"]);
  });
});
