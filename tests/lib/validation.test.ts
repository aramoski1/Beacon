import { describe, expect, it } from "vitest";
import {
  isValidDate,
  isValidEmail,
  validateName,
  validateEmail,
  validateRequiredDate,
  validateOptionalDate,
  validateOutreach,
} from "@/lib/validation";

describe("isValidDate", () => {
  it("accepts a valid date", () => {
    expect(isValidDate("2026-07-14")).toBe(true);
  });
  it("accepts leap day on a leap year", () => {
    expect(isValidDate("2024-02-29")).toBe(true);
  });
  it("rejects leap day on a non-leap year", () => {
    expect(isValidDate("2025-02-29")).toBe(false);
  });
  it("rejects wrong format", () => {
    expect(isValidDate("07/14/2026")).toBe(false);
    expect(isValidDate("2026-7-14")).toBe(false);
    expect(isValidDate("not-a-date")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isValidDate("")).toBe(false);
  });
  it("rejects impossible month/day", () => {
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-04-31")).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts standard emails", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("a+b@sub.domain.org")).toBe(true);
  });
  it("rejects emails without @", () => {
    expect(isValidEmail("notanemail")).toBe(false);
  });
  it("rejects emails without TLD", () => {
    expect(isValidEmail("user@localhost")).toBe(false);
  });
  it("rejects emails with spaces", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
  });
});

describe("validateName", () => {
  it("passes a normal name", () => {
    expect(validateName("Alice")).toBeNull();
  });
  it("fails on empty string", () => {
    expect(validateName("")).not.toBeNull();
    expect(validateName("  ")?.field).toBe("name");
  });
  it("fails on null/undefined", () => {
    expect(validateName(null)).not.toBeNull();
    expect(validateName(undefined)).not.toBeNull();
  });
  it("fails when name exceeds 200 chars", () => {
    const err = validateName("A".repeat(201));
    expect(err).not.toBeNull();
    expect(err?.message).toMatch(/200/);
  });
  it("passes exactly 200 chars", () => {
    expect(validateName("A".repeat(200))).toBeNull();
  });
  it("uses the custom field name in error", () => {
    expect(validateName("", "contact_name")?.field).toBe("contact_name");
  });
});

describe("validateEmail", () => {
  it("passes null/undefined (optional)", () => {
    expect(validateEmail(null)).toBeNull();
    expect(validateEmail(undefined)).toBeNull();
    expect(validateEmail("")).toBeNull();
  });
  it("passes a valid email", () => {
    expect(validateEmail("test@example.com")).toBeNull();
  });
  it("fails on invalid format", () => {
    expect(validateEmail("not-valid")).not.toBeNull();
    expect(validateEmail("missing@tld")?.field).toBe("email");
  });
});

describe("validateRequiredDate", () => {
  it("passes a valid YYYY-MM-DD date", () => {
    expect(validateRequiredDate("2026-01-15")).toBeNull();
  });
  it("fails on empty / null / undefined", () => {
    expect(validateRequiredDate("")).not.toBeNull();
    expect(validateRequiredDate(null)).not.toBeNull();
    expect(validateRequiredDate(undefined)).not.toBeNull();
  });
  it("fails on wrong format", () => {
    expect(validateRequiredDate("01/15/2026")).not.toBeNull();
    expect(validateRequiredDate("2026-1-5")).not.toBeNull();
  });
  it("fails on impossible date", () => {
    expect(validateRequiredDate("2026-02-30")).not.toBeNull();
  });
  it("uses custom field label in error", () => {
    expect(validateRequiredDate("", "due_date")?.message).toMatch(/due_date/);
  });
});

describe("validateOptionalDate", () => {
  it("passes null/empty (optional)", () => {
    expect(validateOptionalDate(null)).toBeNull();
    expect(validateOptionalDate("")).toBeNull();
    expect(validateOptionalDate("  ")).toBeNull();
  });
  it("passes a valid date when provided", () => {
    expect(validateOptionalDate("2026-12-31")).toBeNull();
  });
  it("fails when a non-empty invalid date is supplied", () => {
    expect(validateOptionalDate("not-a-date")).not.toBeNull();
    expect(validateOptionalDate("2026-13-01")).not.toBeNull();
  });
});

describe("validateOutreach", () => {
  const longStr = (n: number) => "x".repeat(n);

  it("passes valid subject and body", () => {
    expect(validateOutreach("Hello", "Body text")).toHaveLength(0);
  });
  it("fails on empty subject", () => {
    const errs = validateOutreach("", "Body");
    expect(errs.some((e) => e.field === "subject")).toBe(true);
  });
  it("fails on empty body", () => {
    const errs = validateOutreach("Subject", "");
    expect(errs.some((e) => e.field === "body")).toBe(true);
  });
  it("fails on whitespace-only subject and body", () => {
    const errs = validateOutreach("   ", "   ");
    expect(errs).toHaveLength(2);
  });
  it("fails when subject exceeds 500 chars", () => {
    const errs = validateOutreach(longStr(501), "Body");
    expect(errs.some((e) => e.field === "subject")).toBe(true);
  });
  it("passes subject of exactly 500 chars", () => {
    const errs = validateOutreach(longStr(500), "Body");
    expect(errs).toHaveLength(0);
  });
  it("fails when body exceeds 10 000 chars", () => {
    const errs = validateOutreach("Subject", longStr(10_001));
    expect(errs.some((e) => e.field === "body")).toBe(true);
  });
  it("passes body of exactly 10 000 chars", () => {
    const errs = validateOutreach("Subject", longStr(10_000));
    expect(errs).toHaveLength(0);
  });
});
