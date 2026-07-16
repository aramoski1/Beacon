import { describe, it, expect, beforeAll } from "vitest";
import * as XLSX from "xlsx";
import {
  parseNoticePeriod,
  subtractNoticePeriod,
  buildCriticalDates,
  buildIcsString,
  buildExcelBytes,
  buildWordBytes,
  buildPdfBytes,
  formatDate,
  type LeaseAbstractExport,
} from "@/lib/lease-export";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ABSTRACT: LeaseAbstractExport = {
  id: "test-123",
  source_document: "user-abc/1234567890-lease-sample.pdf",
  execution_date: "2024-01-01",
  expiration_date: "2029-12-31",
  term: "5 years",
  base_rate: 25,
  escalations: [
    { description: "Annual CPI increase", rate: "3%", effective_date: "2025-01-01" },
  ],
  options: [
    { type: "renewal", description: "5-year renewal option", notice_period: "6 months" },
    { type: "termination", description: "Early termination right", notice_period: "90 days" },
  ],
  key_provisions: [
    { provision: "Tenant shall maintain all-risk property insurance.", citation: "Section 12.1" },
    { provision: "Landlord responsible for structural repairs." },
  ],
  field_citations: [
    { field: "execution_date", page: "1", text: "This Lease is executed on January 1, 2024." },
    { field: "base_rate",      page: "2", text: "The base rent shall be $25.00 per square foot." },
  ],
  custom_fields: { tenant_name: "ACME Corp", security_deposit: 50000 },
};

const ABSTRACT_NO_DATES: LeaseAbstractExport = {
  ...ABSTRACT,
  expiration_date: null,
  options: [],
};

// ─── parseNoticePeriod ────────────────────────────────────────────────────────

describe("parseNoticePeriod", () => {
  it("parses months", () => expect(parseNoticePeriod("6 months")).toEqual({ amount: 6, unit: "months" }));
  it("parses singular month", () => expect(parseNoticePeriod("1 month")).toEqual({ amount: 1, unit: "months" }));
  it("parses hyphenated months", () => expect(parseNoticePeriod("6-month notice")).toEqual({ amount: 6, unit: "months" }));
  it("parses days", () => expect(parseNoticePeriod("90 days")).toEqual({ amount: 90, unit: "days" }));
  it("parses singular day", () => expect(parseNoticePeriod("30 day")).toEqual({ amount: 30, unit: "days" }));
  it("parses years", () => expect(parseNoticePeriod("1 year")).toEqual({ amount: 1, unit: "years" }));
  it("parses plural years", () => expect(parseNoticePeriod("2 years")).toEqual({ amount: 2, unit: "years" }));
  it("returns null for unparseable text", () => expect(parseNoticePeriod("reasonable notice")).toBeNull());
  it("returns null for empty string", () => expect(parseNoticePeriod("")).toBeNull());
  it("is case-insensitive", () => expect(parseNoticePeriod("3 MONTHS")).toEqual({ amount: 3, unit: "months" }));
});

// ─── subtractNoticePeriod ─────────────────────────────────────────────────────

describe("subtractNoticePeriod", () => {
  it("subtracts days", () => {
    expect(subtractNoticePeriod("2029-12-31", { amount: 90, unit: "days" })).toBe("2029-10-02");
  });
  it("subtracts months (may roll end-of-month)", () => {
    // Dec 31 − 6 months: JS rolls June 31 → July 1
    expect(subtractNoticePeriod("2029-12-31", { amount: 6, unit: "months" })).toBe("2029-07-01");
  });
  it("subtracts months from non-overflow date", () => {
    expect(subtractNoticePeriod("2029-12-15", { amount: 6, unit: "months" })).toBe("2029-06-15");
  });
  it("subtracts years", () => {
    expect(subtractNoticePeriod("2029-12-31", { amount: 1, unit: "years" })).toBe("2028-12-31");
  });
});

// ─── buildCriticalDates ───────────────────────────────────────────────────────

describe("buildCriticalDates", () => {
  it("includes lease expiration event", () => {
    const dates = buildCriticalDates(ABSTRACT);
    expect(dates.some(d => d.label === "Lease Expiration")).toBe(true);
    expect(dates.find(d => d.label === "Lease Expiration")?.date).toBe("2029-12-31");
  });

  it("includes notice deadline for renewal option", () => {
    const dates = buildCriticalDates(ABSTRACT);
    const renewal = dates.find(d => d.label.includes("Renewal"));
    expect(renewal).toBeDefined();
    expect(renewal!.date).toBe("2029-07-01"); // Dec 31 − 6 months
  });

  it("includes notice deadline for termination option", () => {
    const dates = buildCriticalDates(ABSTRACT);
    const term = dates.find(d => d.label.includes("Termination"));
    expect(term).toBeDefined();
    expect(term!.date).toBe("2029-10-02"); // Dec 31 − 90 days
  });

  it("returns empty array when no expiration date", () => {
    const dates = buildCriticalDates(ABSTRACT_NO_DATES);
    expect(dates).toHaveLength(0);
  });

  it("sorts dates ascending", () => {
    const dates = buildCriticalDates(ABSTRACT);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].date >= dates[i - 1].date).toBe(true);
    }
  });

  it("skips option notice when notice_period is unparseable", () => {
    const abs: LeaseAbstractExport = {
      ...ABSTRACT,
      options: [{ type: "renewal", description: "Renewal", notice_period: "reasonable notice" }],
    };
    const dates = buildCriticalDates(abs);
    // Only the expiration event; no notice deadline
    expect(dates).toHaveLength(1);
    expect(dates[0].label).toBe("Lease Expiration");
  });
});

// ─── buildIcsString ───────────────────────────────────────────────────────────

describe("buildIcsString", () => {
  const ics = buildIcsString(ABSTRACT);

  it("wraps in VCALENDAR", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("includes VERSION and PRODID headers", () => {
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:");
  });

  it("contains expiration date in YYYYMMDD format", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20291231");
  });

  it("labels expiration event correctly", () => {
    expect(ics).toContain("SUMMARY:Lease Expiration");
  });

  it("contains notice deadline VEVENTs", () => {
    expect(ics).toContain("Notice Deadline");
  });

  it("uses CRLF line endings (RFC 5545)", () => {
    expect(ics).toContain("\r\n");
  });

  it("escapes commas in text", () => {
    const abs: LeaseAbstractExport = {
      ...ABSTRACT_NO_DATES,
      expiration_date: "2029-12-31",
      options: [],
      source_document: "user/file, with comma.pdf",
    };
    const out = buildIcsString(abs);
    // Comma in file name should be escaped in DESCRIPTION
    expect(out).toContain("\\,");
  });

  it("returns empty string when no dates to export", () => {
    expect(buildIcsString(ABSTRACT_NO_DATES)).toBe("");
  });
});

// ─── buildExcelBytes ──────────────────────────────────────────────────────────

describe("buildExcelBytes", () => {
  let bytes: Uint8Array;
  let wb: XLSX.WorkBook;

  beforeAll(() => {
    bytes = buildExcelBytes(ABSTRACT);
    wb = XLSX.read(bytes);
  });

  it("produces non-empty bytes", () => {
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("has three sheets", () => {
    expect(wb.SheetNames).toHaveLength(3);
  });

  it("sheet names are Abstract, Critical Dates, Citations", () => {
    expect(wb.SheetNames).toEqual(["Abstract", "Critical Dates", "Citations"]);
  });

  it("Abstract sheet has header row", () => {
    const ws = wb.Sheets["Abstract"];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    expect(rows[0]).toEqual(["Field", "Value"]);
  });

  it("Abstract sheet contains execution date row", () => {
    const ws = wb.Sheets["Abstract"];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    const execRow = rows.find(r => r[0] === "Execution Date");
    expect(execRow).toBeDefined();
    expect(execRow![1]).toBe("2024-01-01");
  });

  it("Critical Dates sheet has header row", () => {
    const ws = wb.Sheets["Critical Dates"];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    expect(rows[0]).toEqual(["Event", "Date", "Description"]);
  });

  it("Critical Dates sheet includes expiration row", () => {
    const ws = wb.Sheets["Critical Dates"];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    expect(rows.some(r => r[0] === "Lease Expiration")).toBe(true);
  });

  it("Citations sheet has header row", () => {
    const ws = wb.Sheets["Citations"];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    expect(rows[0]).toEqual(["Field", "Page", "Excerpt"]);
  });

  it("Citations sheet has correct row count", () => {
    const ws = wb.Sheets["Citations"];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    // Header + 2 citations
    expect(rows).toHaveLength(3);
  });
});

// ─── buildWordBytes ───────────────────────────────────────────────────────────

describe("buildWordBytes", () => {
  it("returns a non-empty Uint8Array", async () => {
    const bytes = await buildWordBytes(ABSTRACT);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("starts with PK zip signature (docx is a zip)", async () => {
    const bytes = await buildWordBytes(ABSTRACT);
    // DOCX files are ZIP archives starting with PK (0x50 0x4B)
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
  });

  it("works with a minimal abstract (no escalations/options)", async () => {
    const minimal: LeaseAbstractExport = {
      ...ABSTRACT,
      escalations: [],
      options: [],
      key_provisions: [],
      field_citations: [],
      custom_fields: null,
    };
    const bytes = await buildWordBytes(minimal);
    expect(bytes.length).toBeGreaterThan(500);
  });
});

// ─── buildPdfBytes ────────────────────────────────────────────────────────────

describe("buildPdfBytes", () => {
  it("returns a non-empty Uint8Array", async () => {
    const bytes = await buildPdfBytes(ABSTRACT);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("starts with %PDF signature", async () => {
    const bytes = await buildPdfBytes(ABSTRACT);
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  });

  it("works with empty sections", async () => {
    const minimal: LeaseAbstractExport = {
      ...ABSTRACT_NO_DATES,
      expiration_date: "2030-06-30",
    };
    const bytes = await buildPdfBytes(minimal);
    expect(bytes[0]).toBe(0x25);
  });
});

// ─── formatDate ───────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats ISO date to long form", () => {
    expect(formatDate("2024-01-01")).toBe("January 1, 2024");
  });
  it("returns — for null", () => {
    expect(formatDate(null)).toBe("—");
  });
});
