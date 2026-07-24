import { describe, expect, it } from "vitest";
import {
  preferDisplayOwnerContact,
  stagingDiffersFromCrm,
} from "../../lib/owner-contacts";

describe("preferDisplayOwnerContact", () => {
  it("prefers linked CRM over staging", () => {
    const d = preferDisplayOwnerContact({
      linkedCrm: [{ id: "c1", name: "Jane CRM", email: "j@x.com", mailing_address: "1 Main" }],
      ownerContacts: [{ name: "Staging Bob", title: "", address: null }],
      ownerName: "Some LLC",
      ownerEmail: "stage@x.com",
    });
    expect(d?.source).toBe("crm");
    expect(d?.contactId).toBe("c1");
    expect(d?.name).toBe("Jane CRM");
    expect(d?.email).toBe("j@x.com");
    expect(d?.staging[0]?.name).toBe("Staging Bob");
  });

  it("falls back to staging when no CRM link", () => {
    const d = preferDisplayOwnerContact({
      linkedCrm: [],
      ownerContacts: [{ name: "Bob", title: "Mgr", address: "2 Oak" }],
      ownerName: "Bob",
      ownerEmail: "b@x.com",
    });
    expect(d?.source).toBe("staging");
    expect(d?.name).toBe("Bob");
    expect(d?.email).toBe("b@x.com");
    expect(d?.address).toBe("2 Oak");
  });

  it("returns null when empty", () => {
    expect(
      preferDisplayOwnerContact({
        linkedCrm: [],
        ownerContacts: [],
        ownerName: "ACME LLC",
        ownerEmail: null,
      }),
    ).toBeNull();
  });
});

describe("stagingDiffersFromCrm", () => {
  it("detects name mismatch", () => {
    expect(stagingDiffersFromCrm([{ name: "A", title: "", address: null }], "B")).toBe(true);
    expect(stagingDiffersFromCrm([{ name: "A", title: "", address: null }], "a")).toBe(false);
  });
});
