import { describe, expect, it } from "vitest";
import {
  autoSuggestMapping,
  applyPropertyMapping,
  applyContactMapping,
  deduplicateProperties,
  deduplicateContacts,
  normalizeContactTier,
  normalizeAddress,
  type Mapping,
} from "@/lib/import-mapper";

// ─── autoSuggestMapping — properties ─────────────────────────────────────────

describe("autoSuggestMapping — property", () => {
  it("maps obvious property headers", () => {
    const headers = ["Property Address", "City", "SF", "Owner", "URL"];
    const mapping = autoSuggestMapping(headers, "property");
    expect(mapping.address).toBe("Property Address");
    expect(mapping.city).toBe("City");
    expect(mapping.size_sqft).toBe("SF");
    expect(mapping.owner_name).toBe("Owner");
    expect(mapping.source_url).toBe("URL");
  });

  it("maps case-insensitive aliases", () => {
    const headers = ["SQFT", "PROPERTY TYPE", "LAST SALE PRICE", "LAST SALE DATE"];
    const mapping = autoSuggestMapping(headers, "property");
    expect(mapping.size_sqft).toBe("SQFT");
    expect(mapping.property_type).toBe("PROPERTY TYPE");
    expect(mapping.last_sale_price).toBe("LAST SALE PRICE");
    expect(mapping.last_sale_date).toBe("LAST SALE DATE");
  });

  it("does not double-assign the same header", () => {
    const headers = ["Address", "Address 2"];
    const mapping = autoSuggestMapping(headers, "property");
    const values = Object.values(mapping);
    const set = new Set(values.filter(Boolean));
    expect(set.size).toBe(values.filter(Boolean).length);
  });

  it("returns empty mapping for unrelated headers", () => {
    const headers = ["foo", "bar", "baz"];
    const mapping = autoSuggestMapping(headers, "property");
    expect(Object.values(mapping).filter(Boolean).length).toBe(0);
  });

  it("handles CoStar-style headers", () => {
    const headers = ["Building Address", "RSF", "Ownership Type", "Property Name"];
    const mapping = autoSuggestMapping(headers, "property");
    expect(mapping.address).toBe("Building Address");
    expect(mapping.size_sqft).toBe("RSF");
    expect(mapping.ownership_type).toBe("Ownership Type");
  });
});

// ─── autoSuggestMapping — contacts ────────────────────────────────────────────

describe("autoSuggestMapping — contact", () => {
  it("maps obvious contact headers", () => {
    const headers = ["Full Name", "Company", "Email", "Cell Phone", "Tier"];
    const mapping = autoSuggestMapping(headers, "contact");
    expect(mapping.name).toBe("Full Name");
    expect(mapping.company).toBe("Company");
    expect(mapping.email).toBe("Email");
    expect(mapping.phone).toBe("Cell Phone");
    expect(mapping.contact_tier).toBe("Tier");
  });

  it("maps 'Contact' header to name", () => {
    const headers = ["Contact", "Firm", "Email Address"];
    const mapping = autoSuggestMapping(headers, "contact");
    expect(mapping.name).toBe("Contact");
    expect(mapping.company).toBe("Firm");
    expect(mapping.email).toBe("Email Address");
  });
});

// ─── applyPropertyMapping ─────────────────────────────────────────────────────

describe("applyPropertyMapping", () => {
  const mapping: Mapping = {
    address:        "Addr",
    city:           "City",
    size_sqft:      "SQFT",
    last_sale_price:"Price",
    property_type:  "Type",
    ownership_type: "Owner Type",
  };

  it("maps a full row correctly", () => {
    const row = {
      Addr: "123 Main St",
      City: "Miami",
      SQFT: "15,000",
      Price: "$5,000,000",
      Type: "Office",
      "Owner Type": "LLC",
    };
    const result = applyPropertyMapping(row, mapping);
    expect(result).not.toBeNull();
    expect(result!.address).toBe("123 Main St");
    expect(result!.city).toBe("Miami");
    expect(result!.size_sqft).toBe(15000);
    expect(result!.last_sale_price).toBe(5000000);
    expect(result!.property_type).toBe("office");
    expect(result!.ownership_type).toBe("institutional");
  });

  it("returns null when address column is empty", () => {
    const row = { Addr: "", City: "Miami" };
    expect(applyPropertyMapping(row, mapping)).toBeNull();
  });

  it("strips dollar signs and commas from numeric fields", () => {
    const row = { Addr: "1 Oak St", SQFT: "1,500", Price: "$750,000" };
    const result = applyPropertyMapping(row, mapping);
    expect(result!.size_sqft).toBe(1500);
    expect(result!.last_sale_price).toBe(750000);
  });

  it("normalizes property types", () => {
    const cases: Record<string, string> = {
      Warehouse: "industrial",
      "Medical Office": "office",
      Apartments: "multifamily",
      Retail: "retail",
      "Vacant Land": "land",
    };
    for (const [input, expected] of Object.entries(cases)) {
      const row = { Addr: "1 A St", Type: input };
      expect(applyPropertyMapping(row, { ...mapping, property_type: "Type" })!.property_type).toBe(expected);
    }
  });

  it("normalizes ownership types", () => {
    const cases: Record<string, string> = {
      "ACME LLC": "institutional",
      "Private Individual": "private",
      "REIT": "REIT",
      "Person": "private",
    };
    for (const [input, expected] of Object.entries(cases)) {
      const row = { Addr: "1 A St", "Owner Type": input };
      expect(applyPropertyMapping(row, { ...mapping, ownership_type: "Owner Type" })!.ownership_type).toBe(expected);
    }
  });
});

// ─── applyContactMapping ──────────────────────────────────────────────────────

describe("applyContactMapping", () => {
  const mapping: Mapping = {
    name:         "Name",
    company:      "Co",
    email:        "Email",
    phone:        "Phone",
    contact_tier: "Tier",
    role:         "Title",
  };

  it("maps a full contact row", () => {
    const row = { Name: "Alice Smith", Co: "ACME", Email: "alice@acme.com", Phone: "555-1234", Tier: "1", Title: "VP" };
    const result = applyContactMapping(row, mapping);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Alice Smith");
    expect(result!.company).toBe("ACME");
    expect(result!.email).toBe("alice@acme.com");
    expect(result!.contact_tier).toBe(1);
    expect(result!.role).toBe("VP");
    expect(result!.contact_type).toBeNull();
  });

  it("maps owner vs tenant book", () => {
    const mapping: Mapping = { name: "Name", contact_type: "Type" };
    expect(applyContactMapping({ Name: "A", Type: "Owner" }, mapping)!.contact_type).toBe("owner");
    expect(applyContactMapping({ Name: "B", Type: "Tenant" }, mapping)!.contact_type).toBe("tenant");
  });

  it("returns null when name is empty", () => {
    const row = { Name: "", Email: "a@b.com" };
    expect(applyContactMapping(row, mapping)).toBeNull();
  });

  it("returns null when name column not in row", () => {
    const row = { Email: "a@b.com" };
    expect(applyContactMapping(row, mapping)).toBeNull();
  });
});

// ─── normalizeContactTier ─────────────────────────────────────────────────────

describe("normalizeContactTier", () => {
  it.each([
    ["1", 1], ["2", 2], ["3", 3],
    ["Tier 1", 1], ["Tier 2", 2], ["Tier 3", 3],
    ["A", 1], ["B", 2], ["C", 3],
    ["High Priority", 1], ["Medium", 2], ["Low", 3],
    ["warm", 2], ["cold", 3],
    ["", null], ["unknown", null], ["4", null],
  ])("normalizes '%s' → %s", (input, expected) => {
    expect(normalizeContactTier(input)).toBe(expected);
  });
});

// ─── deduplicateProperties ────────────────────────────────────────────────────

describe("deduplicateProperties", () => {
  function prop(address: string) {
    return {
      address,
      city: null,
      submarket: null,
      owner_name: null,
      ownership_type: "unknown",
      property_type: "other",
      size_sqft: null,
      last_sale_price: null,
      last_sale_date: null,
      source_url: null,
    };
  }

  it("keeps unique addresses", () => {
    const rows = [prop("100 Main St"), prop("200 Oak Ave")];
    const { unique, duplicates } = deduplicateProperties(rows);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("flags exact-duplicate address as duplicate", () => {
    const rows = [prop("100 Main St"), prop("100 Main St")];
    const { unique, duplicates } = deduplicateProperties(rows);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("normalizes case and punctuation before dedup", () => {
    const rows = [prop("100 main st."), prop("100 MAIN ST")];
    const { unique, duplicates } = deduplicateProperties(rows);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("returns both lists when first row wins", () => {
    const a = prop("1 A");
    const b = prop("1 A");
    const { unique, duplicates } = deduplicateProperties([a, b]);
    expect(unique[0]).toBe(a);
    expect(duplicates[0]).toBe(b);
  });
});

// ─── deduplicateContacts ──────────────────────────────────────────────────────

describe("deduplicateContacts", () => {
  function contact(name: string, email: string | null = null, company: string | null = null) {
    return {
      name,
      email,
      company,
      phone: null,
      contact_tier: null,
      ownership_type: "unknown",
      role: null,
      contact_type: null,
    };
  }

  it("keeps unique contacts", () => {
    const rows = [contact("Alice", "alice@a.com"), contact("Bob", "bob@b.com")];
    const { unique, duplicates } = deduplicateContacts(rows);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("deduplicates by email (case-insensitive)", () => {
    const rows = [contact("Alice", "alice@a.com"), contact("Alice Smith", "ALICE@A.COM")];
    const { unique, duplicates } = deduplicateContacts(rows);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("deduplicates by name+company when no email", () => {
    const rows = [contact("Bob Jones", null, "ACME"), contact("Bob Jones", null, "ACME")];
    const { unique, duplicates } = deduplicateContacts(rows);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("does not dedup same name with different companies", () => {
    const rows = [contact("Bob Jones", null, "ACME"), contact("Bob Jones", null, "XYZ")];
    const { unique, duplicates } = deduplicateContacts(rows);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("email takes priority over name for dedup", () => {
    // Same email, different names — should be a dup
    const rows = [contact("Alice A", "shared@email.com"), contact("Alice B", "shared@email.com")];
    const { unique, duplicates } = deduplicateContacts(rows);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });
});

// ─── normalizeAddress ─────────────────────────────────────────────────────────

describe("normalizeAddress", () => {
  it("uppercases and collapses whitespace", () => {
    expect(normalizeAddress("123 main   st")).toBe("123 MAIN ST");
  });

  it("strips periods, commas, and hashes, and uppercases", () => {
    expect(normalizeAddress("100 N.W. 2nd Ave., Suite 100")).toBe("100 NW 2ND AVE SUITE 100");
  });
});
