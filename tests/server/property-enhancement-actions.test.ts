/**
 * Regression coverage for the two enhancement-flow fixes in
 * app/properties/[id]/actions.ts:
 *  - previewCountyEnhancement used to hardcode customExtractFields to `[]`,
 *    so a broker's extract-mode custom fields were never passed to Claude.
 *  - applyDocumentEnhancement must never write an unaccepted conflict field
 *    (owner/sale/SF), and must merge — not clobber — custom_fields / field_sources.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

vi.mock("@/lib/custom-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/custom-fields")>();
  return { ...actual, fetchFieldDefs: vi.fn() };
});

vi.mock("@/lib/property-pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/property-pipeline")>();
  return { ...actual, extractPropertyFields: vi.fn() };
});

vi.mock("@/lib/mdpa", () => ({
  searchByAddressGIS: vi.fn(),
  getPropertyDetail: vi.fn(),
  extractOwnerMailing: vi.fn().mockReturnValue(null),
  parseAddressForGIS: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { fetchFieldDefs, type FieldDefinition } from "@/lib/custom-fields";
import { extractPropertyFields, type ExtractedProperty } from "@/lib/property-pipeline";
import { getPropertyDetail } from "@/lib/mdpa";
import { previewCountyEnhancement, applyDocumentEnhancement } from "@/app/properties/[id]/actions";

// ─── Mock Supabase builder ────────────────────────────────────────────────────

function buildSupabaseSpy(existingRow: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];

  function makeChain(table: string) {
    let mode: "select" | "update" = "select";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "update") {
            return (data: Record<string, unknown>) => {
              mode = "update";
              if (table === "properties") updates.push(data);
              return proxy;
            };
          }
          if (prop === "single" || prop === "maybeSingle") {
            return () =>
              Promise.resolve(
                mode === "select" && table === "properties"
                  ? { data: existingRow, error: null }
                  : { data: null, error: null }
              );
          }
          if (prop === "then") {
            return (onf: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onf);
          }
          return () => proxy;
        },
      }
    );
    return proxy;
  }

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: vi.fn((table: string) => makeChain(table)),
  };

  return { supabase, updates };
}

function fieldDef(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: "fd-1",
    owner_id: "user-1",
    entity_type: "property",
    field_name: "Clear Height",
    field_type: "text",
    select_options: null,
    fill_mode: "extract",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function extractedProperty(overrides: Partial<ExtractedProperty> = {}): ExtractedProperty {
  return {
    address: "123 Main St",
    city: "Miami",
    submarket: null,
    owner_name: "John Smith",
    ownership_type: "private",
    size_sqft: 10_000,
    property_type: "industrial",
    last_sale_date: "2022-01-01",
    last_sale_price: 1_000_000,
    building_composition: {},
    confidence_flags: [],
    custom_fields: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── previewCountyEnhancement: custom-field pass-through ──────────────────────

describe("previewCountyEnhancement — custom-field pass-through", () => {
  it("passes the broker's extract-mode custom field definitions to extractPropertyFields (Miami-Dade path)", async () => {
    const { supabase } = buildSupabaseSpy({
      owner_name: null,
      size_sqft: null,
      last_sale_date: null,
      last_sale_price: null,
      building_composition: null,
      owner_mailing_address: null,
      land_sqft: null,
      asset_description: null,
    });
    (createClient as Mock).mockResolvedValue(supabase);

    const customDefs = [fieldDef({ field_name: "Clear Height" }), fieldDef({ id: "fd-2", field_name: "Dock Doors" })];
    (fetchFieldDefs as Mock).mockResolvedValue(customDefs);
    (getPropertyDetail as Mock).mockResolvedValue({ OwnerInfos: [{ Name: "John Smith" }] });
    (extractPropertyFields as Mock).mockResolvedValue(extractedProperty());

    // 13-digit strap → Miami-Dade branch (Broward straps are 12 digits)
    const result = await previewCountyEnhancement("prop-1", "3059330020010", "123 Main St");

    expect("error" in result).toBe(false);
    expect(extractPropertyFields).toHaveBeenCalledTimes(1);
    const passedCustomFields = (extractPropertyFields as Mock).mock.calls[0][2];
    expect(passedCustomFields).toEqual(customDefs);
    expect(passedCustomFields.length).toBeGreaterThan(0);
  });
});

// ─── applyDocumentEnhancement: conflict gating + merge rules ──────────────────

describe("applyDocumentEnhancement", () => {
  const existingRow = {
    owner_name: "Existing Owner LLC",
    size_sqft: 10_000,
    land_sqft: 20_000,
    asset_description: "Old description",
    last_sale_date: "2020-01-01",
    last_sale_price: 900_000,
    custom_fields: { dock_doors: "2" },
    confidence_flags: [{ field: "owner_name", reason: "not found in source record" }],
    field_sources: { owner_name: "county" },
  };

  it("never writes an unaccepted conflict field, but does write plain changes and merges custom_fields", async () => {
    const { supabase, updates } = buildSupabaseSpy(existingRow);
    (createClient as Mock).mockResolvedValue(supabase);
    (fetchFieldDefs as Mock).mockResolvedValue([fieldDef({ field_name: "Dock Doors" })]);

    const extracted = extractedProperty({
      owner_name: "New Owner LLC", // conflict — differs from existing, authoritative
      building_composition: { dor_description: "New description" }, // non-authoritative change
      custom_fields: { dock_doors: "6" }, // custom field overwrite (never gated)
    });

    const result = await applyDocumentEnhancement("prop-1", extracted, [], "pasted", null);

    expect("error" in result).toBe(false);
    expect(updates).toHaveLength(1);
    const payload = updates[0];

    // Conflict not accepted — must not be in the update payload at all.
    expect(payload.owner_name).toBeUndefined();
    // Non-authoritative change — applied.
    expect(payload.asset_description).toBe("New description");
    // Custom field merge: overwritten value present, other existing keys untouched.
    expect(payload.custom_fields).toEqual({ dock_doors: "6" });
    // field_sources only tags touched fields — the untouched conflict field
    // keeps whatever provenance tag it already had (still "county" here).
    expect((payload.field_sources as Record<string, string>).asset_description).toBe("pasted");
    expect((payload.field_sources as Record<string, string>).owner_name).toBe("county");
  });

  it("writes an accepted conflict field", async () => {
    const { supabase, updates } = buildSupabaseSpy(existingRow);
    (createClient as Mock).mockResolvedValue(supabase);
    (fetchFieldDefs as Mock).mockResolvedValue([fieldDef({ field_name: "Dock Doors" })]);

    const extracted = extractedProperty({
      owner_name: "New Owner LLC",
      custom_fields: {},
    });

    const result = await applyDocumentEnhancement("prop-1", extracted, ["owner_name"], "document", "flyer.pdf");

    expect("error" in result).toBe(false);
    const payload = updates[0];
    expect(payload.owner_name).toBe("New Owner LLC");
    expect((payload.field_sources as Record<string, string>).owner_name).toBe("document");
  });

  it("preserves existing custom_fields keys the source didn't touch", async () => {
    const { supabase, updates } = buildSupabaseSpy({
      ...existingRow,
      custom_fields: { dock_doors: "2", clear_height: "18 ft" },
    });
    (createClient as Mock).mockResolvedValue(supabase);
    (fetchFieldDefs as Mock).mockResolvedValue([fieldDef({ field_name: "Dock Doors" })]);

    const extracted = extractedProperty({
      owner_name: "Existing Owner LLC", // unchanged, no conflict
      custom_fields: { dock_doors: "6" },
    });

    await applyDocumentEnhancement("prop-1", extracted, [], "url", "https://example.com/listing");

    const payload = updates[0];
    expect(payload.custom_fields).toEqual({ dock_doors: "6", clear_height: "18 ft" });
  });
});
