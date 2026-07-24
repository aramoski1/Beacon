import { describe, expect, it } from "vitest";
import {
  contactsExportHref,
  exportIdsQuery,
  leasesExportHref,
  MAX_EXPORT_IDS,
  propertiesExportHref,
} from "../../lib/crm-export";

describe("crm-export", () => {
  it("builds full-book and selected hrefs", () => {
    expect(propertiesExportHref()).toBe("/api/export/properties");
    expect(contactsExportHref()).toBe("/api/export/contacts");
    expect(leasesExportHref()).toBe("/api/export/leases");
    expect(propertiesExportHref(["a", "b"])).toContain("ids=");
    expect(leasesExportHref(["a"])).toContain("ids=");
    expect(exportIdsQuery([])).toBeNull();
  });

  it("caps selected export ids", () => {
    const tooMany = Array.from({ length: MAX_EXPORT_IDS + 1 }, (_, i) => `id-${i}`);
    expect(exportIdsQuery(tooMany)).toBeNull();
    expect(propertiesExportHref(tooMany)).toBe("/api/export/properties");
  });
});
