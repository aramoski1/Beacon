import { describe, expect, it } from "vitest";
import { appendTenantRepNotes, formatDealFollowUpDescription } from "../../lib/deal-follow-up";

describe("deal follow-up description", () => {
  it("combines deal name and next action", () => {
    expect(formatDealFollowUpDescription("Doral pursuit", "Send LOI")).toBe("Doral pursuit — Send LOI");
  });

  it("falls back when no next action is given", () => {
    expect(formatDealFollowUpDescription("Doral pursuit", null)).toBe("Doral pursuit — Next action due");
  });
});

describe("appendTenantRepNotes", () => {
  it("appends soft fields without wiping notes", () => {
    expect(appendTenantRepNotes("Hello", { target_sf: "50k", target_submarket: "Doral", timing: "Q3" }))
      .toContain("Target SF: 50k");
    expect(appendTenantRepNotes(null, {})).toBeNull();
  });
});
