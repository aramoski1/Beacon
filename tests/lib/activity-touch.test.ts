import { describe, expect, it } from "vitest";
import {
  formatCallOutcomeNote,
  shouldBumpLastContacted,
} from "../../lib/activity-touch";

describe("shouldBumpLastContacted", () => {
  it("bumps call/email/letter/meeting but not note", () => {
    expect(shouldBumpLastContacted("call")).toBe(true);
    expect(shouldBumpLastContacted("email")).toBe(true);
    expect(shouldBumpLastContacted("letter")).toBe(true);
    expect(shouldBumpLastContacted("meeting")).toBe(true);
    expect(shouldBumpLastContacted("note")).toBe(false);
  });
});

describe("formatCallOutcomeNote", () => {
  it("formats outcomes", () => {
    expect(formatCallOutcomeNote("connected", "Discussed renewal")).toBe(
      "Outcome: connected — Discussed renewal",
    );
    expect(formatCallOutcomeNote("left_vm")).toBe("Outcome: left voicemail");
    expect(formatCallOutcomeNote(null)).toBe("Call logged");
  });
});
