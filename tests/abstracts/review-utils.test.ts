import { describe, it, expect } from "vitest";
import { deriveConfidence, confidenceLevel, fieldLabel, columnPatchForCorrection } from "@/app/abstracts/[id]/review-utils";
import type { FieldCitation } from "@/app/abstracts/[id]/review-utils";

// ─── deriveConfidence ─────────────────────────────────────────────────────────

describe("deriveConfidence", () => {
  it("returns low score when no citation provided", () => {
    expect(deriveConfidence("Jan 1, 2024", undefined)).toBeLessThan(0.4);
  });

  it("returns low score when citation has no text", () => {
    const cit: FieldCitation = { field: "execution_date", page: "1", text: "" };
    expect(deriveConfidence("Jan 1, 2024", cit)).toBeLessThan(0.4);
  });

  it("returns low score when display value is missing", () => {
    const cit: FieldCitation = { field: "execution_date", page: "1", text: "Lease executed January 1" };
    expect(deriveConfidence("—", cit)).toBeLessThan(0.5);
  });

  it("returns high score when value appears verbatim in citation text", () => {
    const cit: FieldCitation = {
      field: "execution_date",
      page: "1",
      text: "This Lease shall commence on January 1, 2024.",
    };
    expect(deriveConfidence("January 1, 2024", cit)).toBeGreaterThanOrEqual(0.9);
  });

  it("returns high score for base rate with dollar value match", () => {
    const cit: FieldCitation = {
      field: "base_rate",
      page: "2",
      text: "The annual base rent shall be $25 per square foot.",
    };
    // "$25" normalised → "25"; "25" is in "25persquarefoot"
    expect(deriveConfidence("$25", cit)).toBeGreaterThanOrEqual(0.9);
  });

  it("returns medium score for partial word match", () => {
    const cit: FieldCitation = {
      field: "term",
      page: "1",
      text: "The lease term is five years commencing upon the commencement date.",
    };
    expect(deriveConfidence("5 years", cit)).toBeGreaterThan(0.4);
    expect(deriveConfidence("5 years", cit)).toBeLessThan(0.95);
  });

  it("score is between 0 and 1", () => {
    const cases: [string, FieldCitation | undefined][] = [
      ["—", undefined],
      ["$50,000", { field: "x", page: "3", text: "rent is fifty thousand dollars" }],
      ["renewal option", { field: "options[0]", page: "4", text: "Tenant shall have a right of renewal." }],
    ];
    for (const [val, cit] of cases) {
      const score = deriveConfidence(val, cit);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ─── confidenceLevel ──────────────────────────────────────────────────────────

describe("confidenceLevel", () => {
  it("labels 0.9 as high", () => expect(confidenceLevel(0.9)).toBe("high"));
  it("labels 0.8 as high", () => expect(confidenceLevel(0.8)).toBe("high"));
  it("labels 0.6 as medium", () => expect(confidenceLevel(0.6)).toBe("medium"));
  it("labels 0.5 as medium", () => expect(confidenceLevel(0.5)).toBe("medium"));
  it("labels 0.3 as low", () => expect(confidenceLevel(0.3)).toBe("low"));
  it("labels 0.2 as low", () => expect(confidenceLevel(0.2)).toBe("low"));
});

// ─── fieldLabel ───────────────────────────────────────────────────────────────

describe("fieldLabel", () => {
  it("returns friendly name for known scalar fields", () => {
    expect(fieldLabel("execution_date")).toBe("Execution date");
    expect(fieldLabel("expiration_date")).toBe("Expiration date");
    expect(fieldLabel("base_rate")).toBe("Base rate");
    expect(fieldLabel("term")).toBe("Term");
  });

  it("handles array notation for escalations", () => {
    expect(fieldLabel("escalations[0]")).toBe("Escalation 1");
    expect(fieldLabel("escalations[2]")).toBe("Escalation 3");
  });

  it("handles array notation for options", () => {
    expect(fieldLabel("options[0]")).toBe("Option 1");
    expect(fieldLabel("options[1]")).toBe("Option 2");
  });

  it("handles array notation for key_provisions", () => {
    expect(fieldLabel("key_provisions[0]")).toBe("Key provision 1");
  });

  it("falls back to Title Case for unknown snake_case keys", () => {
    expect(fieldLabel("custom_field_one")).toBe("Custom Field One");
    expect(fieldLabel("tenant_name")).toBe("Tenant Name");
  });
});

// ─── columnPatchForCorrection ──────────────────────────────────────────────────
// The bug this guards against: a broker corrects expiration_date in the review
// UI, but the fix only ever wrote to field_reviews JSONB — lease radar and
// lease comps read the expiration_date COLUMN directly, so the correction was
// invisible to both. This maps a correction back onto the real column.

describe("columnPatchForCorrection", () => {
  it("maps a valid expiration_date correction onto the column", () => {
    expect(columnPatchForCorrection("expiration_date", "2027-03-15")).toEqual({
      patch: { expiration_date: "2027-03-15" },
    });
  });

  it("maps a valid execution_date correction onto the column", () => {
    expect(columnPatchForCorrection("execution_date", "2024-06-01")).toEqual({
      patch: { execution_date: "2024-06-01" },
    });
  });

  it("rejects an unparseable date rather than silently writing garbage into a DATE column", () => {
    const result = columnPatchForCorrection("expiration_date", "March 15, 2027");
    expect(result && "error" in result).toBe(true);
  });

  it("rejects an invalid calendar date (e.g. day 32) even though it matches the YYYY-MM-DD shape", () => {
    const result = columnPatchForCorrection("expiration_date", "2027-13-45");
    expect(result && "error" in result).toBe(true);
  });

  it("clears expiration_date to null on an empty correction", () => {
    expect(columnPatchForCorrection("expiration_date", "")).toEqual({
      patch: { expiration_date: null },
    });
  });

  it("parses a dollar-and-comma-formatted base_rate into a plain number", () => {
    expect(columnPatchForCorrection("base_rate", "$32,500")).toEqual({
      patch: { base_rate: 32500 },
    });
  });

  it("parses a plain numeric base_rate string", () => {
    expect(columnPatchForCorrection("base_rate", "27.5")).toEqual({
      patch: { base_rate: 27.5 },
    });
  });

  it("rejects a base_rate that has no digits at all", () => {
    const result = columnPatchForCorrection("base_rate", "market rate");
    expect(result && "error" in result).toBe(true);
  });

  it("clears base_rate to null on an empty correction", () => {
    expect(columnPatchForCorrection("base_rate", "")).toEqual({ patch: { base_rate: null } });
  });

  it("passes term through as plain text", () => {
    expect(columnPatchForCorrection("term", "5 years")).toEqual({ patch: { term: "5 years" } });
  });

  it("clears term to null on an empty correction", () => {
    expect(columnPatchForCorrection("term", "  ")).toEqual({ patch: { term: null } });
  });

  it("returns null (no column to sync) for array-based fields", () => {
    expect(columnPatchForCorrection("escalations[0]", "3% annually")).toBeNull();
    expect(columnPatchForCorrection("options[1]", "renewal option")).toBeNull();
    expect(columnPatchForCorrection("key_provisions[0]", "co-tenancy clause")).toBeNull();
  });

  it("returns null for an unrelated/custom field key", () => {
    expect(columnPatchForCorrection("tenant_name", "Acme Corp")).toBeNull();
  });

  it("returns null when correctedValue is undefined (accept/reject, not a correction)", () => {
    expect(columnPatchForCorrection("expiration_date", undefined)).toBeNull();
  });

  it("accepts a numeric base_rate value directly, not just a string", () => {
    expect(columnPatchForCorrection("base_rate", 42)).toEqual({ patch: { base_rate: 42 } });
  });
});
