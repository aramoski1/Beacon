import { describe, it, expect } from "vitest";
import { normalizeAddress, findDuplicate } from "../../lib/property-ingest";

// ─── normalizeAddress ─────────────────────────────────────────────────────────

describe("normalizeAddress", () => {
  // ── Comma stripping ────────────────────────────────────────────────────────

  it("drops everything after the first comma", () => {
    expect(normalizeAddress("200 S Biscayne Blvd, Miami FL 33131")).toBe(
      "200 S BISCAYNE BLVD"
    );
  });

  it("handles multiple commas — only splits on the first", () => {
    expect(normalizeAddress("200 S Biscayne Blvd, Miami, FL")).toBe(
      "200 S BISCAYNE BLVD"
    );
  });

  // ── Unit stripping ─────────────────────────────────────────────────────────

  it("strips 'Ste NNN' suffix", () => {
    expect(normalizeAddress("200 S Biscayne Blvd Ste 100")).toBe(
      "200 S BISCAYNE BLVD"
    );
  });

  it("strips 'Suite NNN' suffix", () => {
    expect(normalizeAddress("1221 Brickell Ave Suite 2000")).toBe(
      "1221 BRICKELL AVE"
    );
  });

  it("strips 'Apt NNN' suffix", () => {
    expect(normalizeAddress("850 NW 42nd Ave Apt 3B")).toBe("850 NW 42ND AVE");
  });

  it("strips 'Unit NNN' suffix", () => {
    expect(normalizeAddress("200 Brickell Ave Unit 1500")).toBe(
      "200 BRICKELL AVE"
    );
  });

  it("strips suite and city together", () => {
    expect(normalizeAddress("200 S Biscayne Blvd Ste 100, Miami FL")).toBe(
      "200 S BISCAYNE BLVD"
    );
  });

  // ── '#' edge cases ─────────────────────────────────────────────────────────

  it("does NOT strip '#NNN' when preceded by a space (no word boundary before '#')", () => {
    // \b# requires a word char immediately before '#' — a space does not qualify
    expect(normalizeAddress("200 Brickell Ave #200")).toBe(
      "200 BRICKELL AVE #200"
    );
  });

  it("DOES strip '#NNN' when it follows a letter with no space", () => {
    // 'e' (word char) → '#' (non-word) → word boundary fires
    expect(normalizeAddress("200 Brickell Ave#200")).toBe("200 BRICKELL AVE");
  });

  it("strips '#NNN' when it ends up on the other side of a comma", () => {
    expect(normalizeAddress("200 Brickell Ave, #200 Miami")).toBe(
      "200 BRICKELL AVE"
    );
  });

  // ── Case and whitespace ────────────────────────────────────────────────────

  it("uppercases the result", () => {
    expect(normalizeAddress("200 s biscayne blvd")).toBe("200 S BISCAYNE BLVD");
  });

  it("collapses multiple internal spaces into one", () => {
    expect(normalizeAddress("200  S  Biscayne  Blvd")).toBe(
      "200 S BISCAYNE BLVD"
    );
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeAddress("  850 NW 42nd Ave  ")).toBe("850 NW 42ND AVE");
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it("is idempotent — already-normalized input is unchanged", () => {
    const once = normalizeAddress("200 S Biscayne Blvd Ste 100, Miami FL");
    expect(normalizeAddress(once)).toBe(once);
  });

  it("produces the same output regardless of source (two different raw forms)", () => {
    const a = normalizeAddress("200 S Biscayne Blvd Ste 100, Miami FL");
    const b = normalizeAddress("200 S BISCAYNE BLVD");
    expect(a).toBe(b);
  });
});

// ─── findDuplicate ────────────────────────────────────────────────────────────

// Minimal mock for the Supabase client.
// Each call to .from() consumes the next pre-configured response in order.
// ilikeCalls records every value passed to .ilike() for assertion.
function mockClient(responses: Array<{ data: { id: string } | null }>) {
  let callIdx = 0;
  const ilikeCalls: string[] = [];

  function makeChain(respIdx: number) {
    const resp = responses[respIdx] ?? { data: null };
    // All builder methods return the same chain; only maybeSingle() resolves.
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      ilike: (_field: string, value: string) => {
        ilikeCalls.push(value);
        return chain;
      },
      maybeSingle: () => Promise.resolve(resp),
    };
    return chain;
  }

  return {
    from: () => makeChain(callIdx++),
    ilikeCalls,
  };
}

describe("findDuplicate", () => {
  const USER = "user-abc";

  // ── source_url priority ────────────────────────────────────────────────────

  it("returns the existing id when source_url matches", async () => {
    const db = mockClient([{ data: { id: "prop-1" } }]);
    const result = await findDuplicate(db, USER, "mdpa:01-4137-023-0020", null);
    expect(result).toBe("prop-1");
  });

  it("returns null when source_url does not match and address is null", async () => {
    const db = mockClient([{ data: null }]);
    const result = await findDuplicate(db, USER, "mdpa:99-0000-000-0000", null);
    expect(result).toBeNull();
  });

  it("returns null immediately when both source_url and address are null", async () => {
    const db = mockClient([]); // no DB calls expected
    const result = await findDuplicate(db, USER, null, null);
    expect(result).toBeNull();
    expect(db.ilikeCalls).toHaveLength(0);
  });

  // ── address fallback ───────────────────────────────────────────────────────

  it("falls through to address match when source_url misses", async () => {
    // first call (source_url) misses; second call (address) hits
    const db = mockClient([{ data: null }, { data: { id: "prop-2" } }]);
    const result = await findDuplicate(
      db,
      USER,
      "https://loopnet.com/listing/99999",
      "1221 Brickell Ave"
    );
    expect(result).toBe("prop-2");
  });

  it("returns null when neither source_url nor address matches", async () => {
    const db = mockClient([{ data: null }, { data: null }]);
    const result = await findDuplicate(
      db,
      USER,
      "https://loopnet.com/listing/99999",
      "1221 Brickell Ave"
    );
    expect(result).toBeNull();
  });

  it("returns null when source_url is null and address produces no match", async () => {
    const db = mockClient([{ data: null }]);
    const result = await findDuplicate(db, USER, null, "1221 Brickell Ave");
    expect(result).toBeNull();
  });

  // ── address normalization ──────────────────────────────────────────────────

  it("normalizes the address before the ilike query", async () => {
    const db = mockClient([{ data: null }, { data: { id: "prop-3" } }]);
    await findDuplicate(
      db,
      USER,
      "https://example.com/new-listing",
      "200 S Biscayne Blvd Ste 100, Miami FL"
    );
    // The ilike must receive the normalized form, not the raw input
    expect(db.ilikeCalls[0]).toBe("200 S BISCAYNE BLVD");
  });

  it("detects the same property from different sources via address", async () => {
    // Tax-roll source_url "mdpa:..." doesn't match a URL-sourced listing,
    // but the normalized addresses are identical.
    const db = mockClient([{ data: null }, { data: { id: "prop-4" } }]);
    const result = await findDuplicate(
      db,
      USER,
      "https://crexi.com/listing/12345",
      "200 S Biscayne Blvd" // same property, different source
    );
    expect(result).toBe("prop-4");
    expect(db.ilikeCalls[0]).toBe("200 S BISCAYNE BLVD");
  });

  // ── short-address guard ────────────────────────────────────────────────────

  it("skips the address query when normalized address is 3 chars or fewer", async () => {
    // After normalization a degenerate address like "123" would be ≤ 3 chars
    // (though unlikely in practice). The guard prevents a too-broad ILIKE.
    const db = mockClient([{ data: null }]); // only one call allowed (source_url)
    const result = await findDuplicate(db, USER, "https://example.com/x", "1 A");
    expect(result).toBeNull();
    expect(db.ilikeCalls).toHaveLength(0);
  });

  it("does run the address query for a 4-char normalized address", async () => {
    // sourceUrl is null → only one DB call (the address query) is made,
    // so the hit goes into responses[0], not [1].
    const db = mockClient([{ data: { id: "prop-5" } }]);
    const result = await findDuplicate(db, USER, null, "1 NW Main Ave");
    // normalizeAddress("1 NW Main Ave") = "1 NW MAIN AVE" (> 3 chars)
    expect(result).toBe("prop-5");
    expect(db.ilikeCalls).toHaveLength(1);
  });
});
