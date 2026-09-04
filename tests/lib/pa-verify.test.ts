import { describe, expect, it } from "vitest";
import { paVerifyFromSourceUrl } from "@/lib/pa-verify";

describe("paVerifyFromSourceUrl", () => {
  it("builds MDPA, BCPA, and PBCPA links", () => {
    expect(paVerifyFromSourceUrl("mdpa:01-2345-67-890")?.label).toBe("MDPA");
    expect(paVerifyFromSourceUrl("bcpa:514209051449")?.label).toBe("BCPA");
    expect(paVerifyFromSourceUrl("pbcpa:1234567890")?.href).toContain("pbcpao.gov");
    expect(paVerifyFromSourceUrl(null)).toBeNull();
  });
});
