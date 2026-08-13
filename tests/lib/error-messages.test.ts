import { describe, it, expect } from "vitest";
import { sanitizeIngestionError } from "../../lib/error-messages";

describe("sanitizeIngestionError", () => {
  describe("ai_extract stage", () => {
    it("translates a low-credit-balance Anthropic error without dumping raw JSON", () => {
      const raw = `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CcP2SChKRE2k45mjpNZSu"}`;
      const result = sanitizeIngestionError("ai_extract", raw);
      expect(result).not.toContain("request_id");
      expect(result).not.toContain("{");
      expect(result.toLowerCase()).toContain("out of usage credits");
    });

    it("translates a rate limit error", () => {
      const raw = `429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}`;
      expect(sanitizeIngestionError("ai_extract", raw)).toMatch(/rate limit/i);
    });

    it("translates an overloaded error", () => {
      const raw = `529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`;
      expect(sanitizeIngestionError("ai_extract", raw)).toMatch(/overloaded/i);
    });

    it("falls back to a generic message for unparseable extraction errors", () => {
      expect(sanitizeIngestionError("ai_extract", "connection reset")).toBe(
        "AI extraction failed unexpectedly — try again."
      );
    });
  });

  describe("sunbiz_search / sunbiz_detail stages", () => {
    it("translates a raw curl command failure without leaking the command line", () => {
      const raw = String.raw`Command failed: curl -s -L --max-time 20 --compressed -A Mozilla/5.0 (Windows NT 10.0; Win64; x64) -c C:\Users\ARAMOS~1\AppData\Local\Temp\sunbiz-255a63593535.txt -b C:\Users\ARAMOS~1\AppData\Local\Temp\sunbiz-255a63593535.txt https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/TEST`;
      const result = sanitizeIngestionError("sunbiz_search", raw);
      expect(result).not.toContain("curl");
      expect(result).not.toContain("C:\\Users");
      expect(result).not.toContain("Mozilla");
      expect(result).toMatch(/sunbiz/i);
    });

    it("translates an HTTP 403 (Cloudflare block) into a rate-limit message", () => {
      const raw = "Sunbiz returned HTTP 403 for https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/TEST";
      expect(sanitizeIngestionError("sunbiz_detail", raw)).toMatch(/rate-limited|blocked/i);
    });

    it("still offers a manual-search fallback for an unrecognized sunbiz error shape", () => {
      expect(sanitizeIngestionError("sunbiz_search", "unexpected failure")).toContain("sunbiz.org");
    });
  });

  describe("other stages", () => {
    it("passes through a normal GIS error unchanged", () => {
      expect(sanitizeIngestionError("gis_fetch", "Cannot perform query. Invalid query parameters.")).toBe(
        "Cannot perform query. Invalid query parameters."
      );
    });

    it("strips a Windows file path from any stage as a safety net", () => {
      const raw = String.raw`Failed to write C:\Users\ARAMOS~1\AppData\Local\Temp\tmpfile.txt: permission denied`;
      const result = sanitizeIngestionError("db_save", raw);
      expect(result).not.toContain("C:\\Users");
      expect(result).toContain("[internal path removed]");
    });

    it("strips a Unix-style file path from any stage as a safety net", () => {
      const raw = "Failed to write /tmp/beacon-upload-8213.pdf: disk full";
      const result = sanitizeIngestionError("db_save", raw);
      expect(result).not.toContain("/tmp/beacon-upload-8213.pdf");
    });

    it("leaves a message with no file path untouched", () => {
      expect(sanitizeIngestionError("mdpa_fetch", "MDPA detail fetch failed: 500")).toBe(
        "MDPA detail fetch failed: 500"
      );
    });
  });
});
