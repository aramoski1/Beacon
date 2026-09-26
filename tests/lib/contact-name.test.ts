import { describe, expect, it } from "vitest";
import { splitContactName } from "../../lib/contact-name";

describe("splitContactName", () => {
  it("greets Mark not Site", () => {
    expect(splitContactName("Site Supervisor Mark Quinn").greeting).toBe("Mark");
    expect(splitContactName("Site Supervisor Mark Quinn").title?.toLowerCase()).toContain("site supervisor");
  });
  it("handles LAST, FIRST", () => {
    expect(splitContactName("LIBI, MAURO").greeting).toBe("MAURO");
    expect(splitContactName("LIBI, MAURO").lastName).toBe("LIBI");
  });
});
