import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/error-reporter", () => ({ captureException: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/error-reporter";
import { logError, logWarn, withAction } from "@/lib/logger";
import { validateExtractedProperty } from "@/lib/property-pipeline";

// ─── Supabase spy ─────────────────────────────────────────────────────────────

function buildSupabaseSpy(insertResult: unknown = { error: null }) {
  const inserts: unknown[] = [];
  const chain = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "insert") {
          return (data: unknown) => {
            inserts.push(data);
            return Promise.resolve(insertResult);
          };
        }
        return () => chain;
      },
    }
  );
  const supabase = { from: vi.fn(() => chain) };
  return { supabase, inserts };
}

// ─── logError ────────────────────────────────────────────────────────────────

describe("logError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes to error_logs table when userId is provided", async () => {
    const { supabase, inserts } = buildSupabaseSpy();
    (createClient as Mock).mockResolvedValue(supabase);

    await logError({
      action: "createContact",
      message: "Unexpected failure",
      userId: "user-1",
      context: { name: "Alice" },
    });

    expect(supabase.from).toHaveBeenCalledWith("error_logs");
    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row.action).toBe("createContact");
    expect(row.message).toBe("Unexpected failure");
    expect(row.owner_id).toBe("user-1");
    expect(row.severity).toBe("error");
  });

  it("skips DB write when userId is absent", async () => {
    const { supabase } = buildSupabaseSpy();
    (createClient as Mock).mockResolvedValue(supabase);

    await logError({ action: "someAction", message: "No user" });

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("calls captureException with correct shape", async () => {
    const { supabase } = buildSupabaseSpy();
    (createClient as Mock).mockResolvedValue(supabase);

    await logError({
      action: "updateDeal",
      message: "DB timeout",
      userId: "user-2",
      context: { dealId: "d1" },
    });

    expect(captureException).toHaveBeenCalledOnce();
    const [err, report] = (captureException as Mock).mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("DB timeout");
    expect(report.action).toBe("updateDeal");
    expect(report.severity).toBe("error");
    expect(report.context).toEqual({ dealId: "d1" });
  });

  it("never throws when supabase insert fails", async () => {
    (createClient as Mock).mockRejectedValue(new Error("connection refused"));

    await expect(
      logError({ action: "test", message: "boom", userId: "u1" })
    ).resolves.toBeUndefined();
  });

  it("never throws when captureException rejects", async () => {
    const { supabase } = buildSupabaseSpy();
    (createClient as Mock).mockResolvedValue(supabase);
    (captureException as Mock).mockRejectedValue(new Error("network error"));

    await expect(
      logError({ action: "test", message: "x", userId: "u1" })
    ).resolves.toBeUndefined();
  });
});

// ─── logWarn ─────────────────────────────────────────────────────────────────

describe("logWarn", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("persists with severity = warn", async () => {
    const { supabase, inserts } = buildSupabaseSpy();
    (createClient as Mock).mockResolvedValue(supabase);

    await logWarn({ action: "getDueContacts", message: "slow query", userId: "u1" });

    const row = inserts[0] as Record<string, unknown>;
    expect(row.severity).toBe("warn");
  });

  it("does not call captureException", async () => {
    const { supabase } = buildSupabaseSpy();
    (createClient as Mock).mockResolvedValue(supabase);

    await logWarn({ action: "x", message: "y", userId: "u1" });

    expect(captureException).not.toHaveBeenCalled();
  });
});

// ─── withAction ──────────────────────────────────────────────────────────────

describe("withAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { supabase } = buildSupabaseSpy();
    (createClient as Mock).mockResolvedValue(supabase);
  });

  it("returns the action result on success", async () => {
    const result = await withAction("createDeal", async () => ({ id: "deal-1" }));
    expect(result).toEqual({ id: "deal-1" });
  });

  it("passes through { error } returns without logging", async () => {
    const result = await withAction("createDeal", async () => ({
      error: "Deal name is required.",
    }));
    expect(result).toEqual({ error: "Deal name is required." });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("catches an unexpected throw and returns a sanitized error", async () => {
    const result = await withAction("createDeal", async () => {
      throw new Error("ECONNRESET: connection lost");
    });

    expect(result).toHaveProperty("error");
    const { error } = result as { error: string };
    expect(error).not.toContain("ECONNRESET");
    expect(error).toMatch(/unexpected error/i);
  });

  it("logs the thrown error with context", async () => {
    await withAction(
      "createDeal",
      async () => { throw new Error("timeout"); },
      { userId: "u1", context: { dealId: "d1" } }
    );

    expect(captureException).toHaveBeenCalledOnce();
    const [err, report] = (captureException as Mock).mock.calls[0];
    expect(err.message).toBe("timeout");
    expect(report.context).toEqual({ dealId: "d1" });
    expect(report.action).toBe("createDeal");
  });

});


// ─── validateExtractedProperty ───────────────────────────────────────────────

describe("validateExtractedProperty", () => {
  const validBase = {
    address: "123 Main St",
    city: "Miami",
    submarket: null,
    owner_name: "ACME LLC",
    ownership_type: "institutional",
    size_sqft: 5000,
    property_type: "office",
    last_sale_date: null,
    last_sale_price: null,
    building_composition: {},
    confidence_flags: [],
  };

  it("accepts a fully valid extracted property", () => {
    expect(validateExtractedProperty(validBase)).toBeNull();
  });

  it("accepts all valid ownership_type values", () => {
    for (const t of ["institutional", "private", "REIT", "owner-occupant", "unknown"]) {
      expect(validateExtractedProperty({ ...validBase, ownership_type: t })).toBeNull();
    }
  });

  it("accepts all valid property_type values", () => {
    for (const t of ["industrial", "office", "retail", "multifamily", "land", "residential", "mixed-use", "other"]) {
      expect(validateExtractedProperty({ ...validBase, property_type: t })).toBeNull();
    }
  });

  it("rejects null / non-object input", () => {
    expect(validateExtractedProperty(null)).not.toBeNull();
    expect(validateExtractedProperty("string")).not.toBeNull();
    expect(validateExtractedProperty(42)).not.toBeNull();
  });

  it("rejects an invalid ownership_type", () => {
    const err = validateExtractedProperty({ ...validBase, ownership_type: "corporation" });
    expect(err).toContain("ownership_type");
  });

  it("rejects a missing ownership_type", () => {
    const { ownership_type: _omit, ...rest } = validBase;
    expect(validateExtractedProperty(rest)).not.toBeNull();
  });

  it("rejects an invalid property_type", () => {
    const err = validateExtractedProperty({ ...validBase, property_type: "warehouse" });
    expect(err).toContain("property_type");
  });

  it("rejects when confidence_flags is not an array", () => {
    const err = validateExtractedProperty({ ...validBase, confidence_flags: null });
    expect(err).toContain("confidence_flags");
  });
});

