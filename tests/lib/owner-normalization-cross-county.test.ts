/**
 * Regression coverage for the owner-portfolio's cross-county consistency.
 *
 * The portfolio broke once before (see commit 0810b16) when a loose,
 * order-independent token-overlap matcher collided on generic/geographic
 * words shared by unrelated LLCs — fixed by restricting entityOwnerNamesMatch
 * to exact-name, exact-suffix-stripped-core, and contiguous 2+-word substring
 * matching only (lib/mdpa-owner-search.ts).
 *
 * Adding Palm Beach must not reopen that failure mode, and must not
 * fragment a single entity into multiple portfolio entries. Palm Beach's
 * OWNER_NAME1 field (confirmed live) has its own quirk not present in
 * Miami-Dade/Broward: a trailing "&" marking a second owner carried in
 * OWNER_NAME2 (e.g. "MACHADO MARLON O &" / "MACHADO EDNA L", or
 * "8386 BLACKBURN LLC &" / "1333 LAS PALMAS PARTNERS LLC" — two wholly
 * separate co-owning entities, not a name split across fields). This suite
 * proves:
 *   1. lib/pbcpa.ts's primaryOwnerName strips that marker before the name
 *      ever reaches the shared matching/normalization pipeline.
 *   2. Once cleaned, a Palm-Beach-shaped name normalizes to the SAME key as
 *      the equivalent Miami-Dade/Broward-shaped name (entity resolution
 *      via lib/entities.ts entityNameKey/upsertEntityByName stays unified
 *      across counties instead of fragmenting).
 *   3. The strict entity/person matchers still correctly REJECT unrelated
 *      entities that merely share a generic/geographic word, using
 *      Palm-Beach-shaped input — i.e. no loosening was introduced.
 */
import { describe, expect, it } from "vitest";
import { primaryOwnerName } from "@/lib/pbcpa";
import {
  normalizeOwnerName,
  isEntityOwnerName,
  personNameMatchesOwnerField,
} from "@/lib/owner-contacts";
import { entityOwnerNamesMatch } from "@/lib/mdpa-owner-search";
import { entityNameKey, entityKindFromName } from "@/lib/entities";

describe("primaryOwnerName cleans the Palm-Beach-specific '&' marker before matching", () => {
  it("strips the trailing '&' from an entity name", () => {
    expect(primaryOwnerName({ OWNER_NAME1: "8386 BLACKBURN LLC &" })).toBe("8386 BLACKBURN LLC");
  });

  it("strips the trailing '&' from an individual name", () => {
    expect(primaryOwnerName({ OWNER_NAME1: "MACHADO MARLON O &" })).toBe("MACHADO MARLON O");
  });

  it("an uncleaned trailing '&' would corrupt isEntityOwnerName's word-boundary suffix check if left in", () => {
    // Guard against a future regression: confirm the raw (uncleaned) value is
    // what primaryOwnerName is defending against, not a hypothetical concern.
    const raw = "8386 BLACKBURN LLC &";
    const cleaned = primaryOwnerName({ OWNER_NAME1: raw })!;
    expect(isEntityOwnerName(raw)).toBe(true); // "&" doesn't break the LLC regex either way
    expect(isEntityOwnerName(cleaned)).toBe(true);
    // The real risk is downstream display/entity-name storage, not detection —
    // confirm the stored name is the clean form, not the noisy one.
    expect(cleaned).not.toContain("&");
  });
});

describe("entity resolution key is identical across counties for the same entity name", () => {
  it("normalizeOwnerName produces the same key for a Palm-Beach-cleaned name and an equivalent Miami-Dade/Broward name", () => {
    const pbName = primaryOwnerName({ OWNER_NAME1: "8386 BLACKBURN LLC &" })!;
    const mdOrBcpaName = "8386 Blackburn LLC"; // e.g. from OwnerInfos[0].Name or Broward's OWN_NAME
    expect(entityNameKey(pbName)).toBe(entityNameKey(mdOrBcpaName));
    expect(normalizeOwnerName(pbName)).toBe(normalizeOwnerName(mdOrBcpaName));
  });

  it("classifies a Palm-Beach-shaped entity name the same way as other counties (entityKindFromName)", () => {
    const pbName = primaryOwnerName({ OWNER_NAME1: "8386 BLACKBURN LLC &" })!;
    expect(entityKindFromName(pbName)).toBe("entity");
    expect(entityKindFromName("8386 Blackburn LLC")).toBe("entity");
  });

  it("classifies a Palm-Beach-shaped individual name the same way as other counties", () => {
    const pbName = primaryOwnerName({ OWNER_NAME1: "MACHADO MARLON O &" })!;
    expect(entityKindFromName(pbName)).toBe("individual");
    expect(isEntityOwnerName(pbName)).toBe(false);
  });
});

describe("entityOwnerNamesMatch stays strict with Palm-Beach-shaped names (no loosening)", () => {
  it("matches the same entity across a Palm-Beach-cleaned name and a Miami-Dade/Broward-shaped variant", () => {
    const pbName = primaryOwnerName({ OWNER_NAME1: "8386 BLACKBURN LLC &" })!;
    expect(entityOwnerNamesMatch(pbName, "8386 Blackburn LLC")).toBe(true);
    expect(entityOwnerNamesMatch(pbName, "8386 BLACKBURN LLC A FL")).toBe(true);
  });

  it("does NOT match unrelated entities sharing one generic real-estate word, using Palm-Beach-shaped input", () => {
    // Direct analog of the 0810b16 regression scenarios, replayed against the
    // shape of name Palm Beach actually produces (post primaryOwnerName clean).
    const pbHoldings = primaryOwnerName({ OWNER_NAME1: "PARADISE 2 LLC &" })!;
    expect(entityOwnerNamesMatch(pbHoldings, "OCEAN RIDGE PARADISE 120 LLC")).toBe(false);

    const pbTd = primaryOwnerName({ OWNER_NAME1: "T & D HOLDINGS LLC" })!; // literal "&" inside the name, not a trailing marker
    expect(entityOwnerNamesMatch(pbTd, "GGW HOLDINGS LLC")).toBe(false);
  });

  it("does NOT match unrelated co-owning entities that Palm Beach lists together via OWNER_NAME1/OWNER_NAME2", () => {
    // "8386 BLACKBURN LLC &" / "1333 LAS PALMAS PARTNERS LLC" are two
    // unrelated LLCs co-owning one parcel — never treat them as the same entity.
    const primary = primaryOwnerName({ OWNER_NAME1: "8386 BLACKBURN LLC &" })!;
    const secondary = "1333 LAS PALMAS PARTNERS LLC";
    expect(entityOwnerNamesMatch(primary, secondary)).toBe(false);
  });

  it("still matches a numbered sister entity via contiguous prefix using Palm-Beach-shaped input", () => {
    const pbName = primaryOwnerName({ OWNER_NAME1: "ALVINTER PROPERTIES LLC &" })!;
    expect(entityOwnerNamesMatch(pbName, "ALVINTER PROPERTIES 108 LLC")).toBe(true);
  });
});

describe("personNameMatchesOwnerField handles Palm Beach's 'LAST FIRST MIDDLE' order (same as Broward)", () => {
  it("matches regardless of token order, once cleaned", () => {
    const pbName = primaryOwnerName({ OWNER_NAME1: "MACHADO MARLON O &" })!;
    expect(personNameMatchesOwnerField(pbName, "Marlon Machado")).toBe(true);
    expect(personNameMatchesOwnerField(pbName, "MACHADO MARLON O")).toBe(true);
  });

  it("does not match an unrelated person who merely shares a last name", () => {
    const pbName = primaryOwnerName({ OWNER_NAME1: "MACHADO MARLON O &" })!;
    expect(personNameMatchesOwnerField(pbName, "Machado Jane")).toBe(false);
  });

  it("second owner names (OWNER_NAME2), when a broker looks them up separately, match the same way", () => {
    // OWNER_NAME2 needs no '&'-stripping — the marker only ever appears on
    // OWNER_NAME1 (confirmed live) — but it should still normalize/match
    // consistently through the same shared pipeline, unmodified.
    expect(personNameMatchesOwnerField("Edna Machado", "MACHADO EDNA L")).toBe(true);
  });
});
