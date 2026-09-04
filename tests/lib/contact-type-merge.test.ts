import { describe, expect, it } from "vitest";
import { normalizeContactType, contactTypeLabel } from "@/lib/contact-type";
import {
  applyOutreachMerge,
  firstNameFromFullName,
  formatMergeSf,
  formatMergeExpiry,
  mergeVarsFromOccupancy,
} from "@/lib/outreach-merge";
import { buildContactOccupancy } from "@/lib/contact-occupancy";

describe("normalizeContactType", () => {
  it("maps owner / tenant aliases", () => {
    expect(normalizeContactType("Owner")).toBe("owner");
    expect(normalizeContactType("landlord")).toBe("owner");
    expect(normalizeContactType("Tenant")).toBe("tenant");
    expect(normalizeContactType("lessee")).toBe("tenant");
    expect(normalizeContactType("other")).toBe("other");
    expect(normalizeContactType("")).toBeNull();
    expect(normalizeContactType("broker")).toBeNull();
  });
});

describe("contactTypeLabel", () => {
  it("labels known types", () => {
    expect(contactTypeLabel("owner")).toBe("Owner");
    expect(contactTypeLabel(null)).toBe("—");
  });
});

describe("applyOutreachMerge", () => {
  it("replaces merge tokens including first_name", () => {
    const out = applyOutreachMerge(
      "Hi {first_name} — {address} ({sf}). Landlord {landlord}, expiry {expiry}.",
      {
        name: "Carlos Rivera",
        first_name: "Carlos",
        address: "100 NW 25th St",
        sf: "80,000 SF",
        landlord: "PALMETTO LLC",
        expiry: "Mar 1, 2027",
      },
    );
    expect(out).toBe(
      "Hi Carlos — 100 NW 25th St (80,000 SF). Landlord PALMETTO LLC, expiry Mar 1, 2027.",
    );
  });
});

describe("firstNameFromFullName", () => {
  it("takes the first word", () => {
    expect(firstNameFromFullName("Carlos Rivera")).toBe("Carlos");
    expect(firstNameFromFullName(null)).toBe("there");
  });
});

describe("merge formatters", () => {
  it("formats SF and expiry", () => {
    expect(formatMergeSf(80000)).toBe("80,000 SF");
    expect(formatMergeSf(null)).toBe("");
    expect(formatMergeExpiry("2027-03-01")).toMatch(/2027/);
  });

  it("prefers leased SF over building SF", () => {
    const vars = mergeVarsFromOccupancy({
      name: "Priya",
      address: "1 Flagler",
      sizeSqft: 100000,
      leasedSf: 42000,
      landlord: "Flagler IP",
      expiry: "2028-06-15",
    });
    expect(vars.sf).toBe("42,000 SF");
    expect(vars.landlord).toBe("Flagler IP");
    expect(vars.first_name).toBe("Priya");
  });
});

describe("buildContactOccupancy", () => {
  it("prefers the tenant's lease property", () => {
    const occ = buildContactOccupancy(
      ["p1", "p2"],
      [
        { id: "p1", address: "A", city: "Miami", submarket: "Doral", property_type: "industrial", size_sqft: 10, land_sqft: 20, last_sale_date: null, last_sale_price: null, owner_name: "Old" },
        { id: "p2", address: "B", city: "Doral", submarket: "Airport West", property_type: "industrial", size_sqft: 50, land_sqft: 60, last_sale_date: null, last_sale_price: null, owner_name: "New LLC" },
      ],
      [{ id: "l1", tenant_contact_id: "c1", linked_property: "p2", expiration_date: "2027-01-01", leased_sf: 25000, landlord_name: "New LLC" }],
      "c1",
    );
    expect(occ.address).toBe("B");
    expect(occ.leasedSf).toBe(25000);
    expect(occ.landlord).toBe("New LLC");
    expect(occ.expiry).toBe("2027-01-01");
  });
});
