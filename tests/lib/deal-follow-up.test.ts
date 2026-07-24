import { describe, expect, it } from "vitest";
import {
  appendTenantRepNotes,
  dealFollowUpDescriptionPrefix,
  formatDealFollowUpDescription,
  isDealFollowUpDescription,
} from "../../lib/deal-follow-up";

describe("deal follow-up description", () => {
  it("prefixes deal id for soft dedupe", () => {
    const d = formatDealFollowUpDescription("abc", "Doral pursuit", "Send LOI");
    expect(d.startsWith(dealFollowUpDescriptionPrefix("abc"))).toBe(true);
    expect(isDealFollowUpDescription(d, "abc")).toBe(true);
    expect(isDealFollowUpDescription(d, "other")).toBe(false);
  });
});

describe("appendTenantRepNotes", () => {
  it("appends soft fields without wiping notes", () => {
    expect(appendTenantRepNotes("Hello", { target_sf: "50k", target_submarket: "Doral", timing: "Q3" }))
      .toContain("Target SF: 50k");
    expect(appendTenantRepNotes(null, {})).toBeNull();
  });
});
