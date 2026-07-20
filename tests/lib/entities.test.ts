import { describe, expect, it } from "vitest";
import {
  entityKindFromName,
  entityNameKey,
  mergeEntityPropertyIds,
} from "../../lib/entities";

describe("entityNameKey", () => {
  it("normalizes case, dots, and whitespace", () => {
    expect(entityNameKey("  A.B.C. Holdings  LLC ")).toBe("abc holdings llc");
  });
});

describe("entityKindFromName", () => {
  it("classifies LLC/INC as entity", () => {
    expect(entityKindFromName("Acme Holdings LLC")).toBe("entity");
    expect(entityKindFromName("Acme Inc.")).toBe("entity");
  });

  it("classifies people as individual", () => {
    expect(entityKindFromName("Jane Doe")).toBe("individual");
  });

  it("returns unknown for empty", () => {
    expect(entityKindFromName(null)).toBe("unknown");
    expect(entityKindFromName("  ")).toBe("unknown");
  });
});

describe("mergeEntityPropertyIds", () => {
  it("unions seed and entity-linked ids without duplicates", () => {
    expect(mergeEntityPropertyIds(["a", "b"], ["b", "c"]).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns seed alone when entity links are empty", () => {
    expect(mergeEntityPropertyIds(["x"], [])).toEqual(["x"]);
  });
});
