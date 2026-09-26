import { describe, it, expect } from "vitest";
import {
  resolveOutreachContact,
  preferOwnerContactCandidate,
  leaseOutreachContext,
  leaseDisplayTitle,
  leaseLabel,
  type LeaseRadarEntry,
  type RadarContactRef,
} from "../../lib/lease-radar";

const tenant: RadarContactRef = {
  id: "t1",
  name: "Acme Tenant LLC",
  email: "ops@acme.com",
  company: "Acme",
};

const owner: RadarContactRef = {
  id: "o1",
  name: "Landlord Holdings",
  email: "owner@holdings.com",
  company: "Holdings",
};

function entry(
  overrides: Partial<Pick<LeaseRadarEntry, "tenant_contact" | "owner_contact">> = {},
): Pick<LeaseRadarEntry, "tenant_contact" | "owner_contact"> {
  return {
    tenant_contact: null,
    owner_contact: null,
    ...overrides,
  };
}

function fullEntry(
  overrides: Partial<LeaseRadarEntry> = {},
): LeaseRadarEntry {
  return {
    id: "lease-1",
    expiration_date: "2026-12-01",
    source_document: "user/lease.pdf",
    base_rate: 45,
    term: "5 years",
    daysUntilExpiry: 60,
    bucket: "3mo",
    urgency: "high",
    property_id: "p1",
    property_address: "100 Brickell Ave",
    property_owner_name: "Holdings LLC",
    leased_sf: 80000,
    property_submarket: "Doral",
    owner_contact: owner,
    tenant_contact: tenant,
    ...overrides,
  };
}

describe("resolveOutreachContact", () => {
  it("tenant_rollover prefers tenant when present", () => {
    const r = resolveOutreachContact("tenant_rollover", entry({ tenant_contact: tenant, owner_contact: owner }));
    expect(r.kind).toBe("ready");
    if (r.kind === "ready") {
      expect(r.role).toBe("tenant");
      expect(r.contact.id).toBe("t1");
      expect(r.why.toLowerCase()).toContain("tenant");
    }
  });

  it("tenant_rollover with only owner → needs_choice (link tenant or email owner)", () => {
    const r = resolveOutreachContact("tenant_rollover", entry({ owner_contact: owner }));
    expect(r.kind).toBe("needs_choice");
    if (r.kind === "needs_choice") {
      expect(r.why.toLowerCase()).toContain("no tenant");
      expect(r.ownerOption?.contact.id).toBe("o1");
      expect(r.ownerOption?.action).toBe("owner_renewal");
    }
  });

  it("tenant_rollover with neither → missing tenant / abstract hint", () => {
    const r = resolveOutreachContact("tenant_rollover", entry());
    expect(r.kind).toBe("missing");
    if (r.kind === "missing") {
      expect(r.want).toBe("tenant");
      expect(r.linkHint).toBe("abstract");
    }
  });

  it("owner_renewal uses owner contact", () => {
    const r = resolveOutreachContact("owner_renewal", entry({ tenant_contact: tenant, owner_contact: owner }));
    expect(r.kind).toBe("ready");
    if (r.kind === "ready") {
      expect(r.role).toBe("owner");
      expect(r.contact.id).toBe("o1");
    }
  });

  it("owner_sale missing owner → property link hint", () => {
    const r = resolveOutreachContact("owner_sale", entry({ tenant_contact: tenant }));
    expect(r.kind).toBe("missing");
    if (r.kind === "missing") {
      expect(r.want).toBe("owner");
      expect(r.linkHint).toBe("property");
    }
  });
});

describe("preferOwnerContactCandidate", () => {
  it("prefers owner-typed contact over non-owner even if tier is worse", () => {
    expect(
      preferOwnerContactCandidate(
        { id: "a", tier: 1, isOwnerType: false },
        { id: "b", tier: 3, isOwnerType: true },
      ),
    ).toBe(true);
  });

  it("keeps owner-typed when candidate is not owner", () => {
    expect(
      preferOwnerContactCandidate(
        { id: "a", tier: 2, isOwnerType: true },
        { id: "b", tier: 1, isOwnerType: false },
      ),
    ).toBe(false);
  });

  it("among same owner flag, prefers lower tier", () => {
    expect(
      preferOwnerContactCandidate(
        { id: "a", tier: 2, isOwnerType: true },
        { id: "b", tier: 1, isOwnerType: true },
      ),
    ).toBe(true);
  });
});

describe("leaseOutreachContext", () => {
  it("tenant context talks to the tenant, not as if emailing owner", () => {
    const ctx = leaseOutreachContext(fullEntry(), "tenant_rollover");
    expect(ctx).toContain("to tenant");
    expect(ctx.toLowerCase()).toContain("tenant");
  });

  it("owner renewal context is owner-facing", () => {
    const ctx = leaseOutreachContext(fullEntry(), "owner_renewal");
    expect(ctx).toContain("OWNER");
    expect(ctx.toLowerCase()).toMatch(/renewal|vacancy/);
  });
});

describe("leaseDisplayTitle", () => {
  it("prefers tenant, then address, and hides seed filenames", () => {
    expect(leaseDisplayTitle({ tenant_contact: tenant, property_address: "100 NW", source_document: "seed:demo" }))
      .toBe("Acme Tenant LLC");
    expect(leaseDisplayTitle({ tenant_contact: null, property_address: "100 NW 25th St", source_document: "seed:demo" }))
      .toBe("100 NW 25th St");
    expect(leaseLabel("seed:demo")).toBe("Lease abstract");
  });
});
