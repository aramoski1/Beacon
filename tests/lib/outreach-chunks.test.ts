import { describe, expect, it } from "vitest";
import {
  chunkIds,
  OUTREACH_CHUNK_SIZE,
  planOutreachBatches,
} from "../../lib/outreach-chunks";

describe("chunkIds", () => {
  it("splits into fixed-size batches", () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns empty for empty input", () => {
    expect(chunkIds([], 10)).toEqual([]);
  });
});

describe("planOutreachBatches", () => {
  it("uses default chunk size of 10", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `c${i}`);
    const plan = planOutreachBatches(ids);
    expect(OUTREACH_CHUNK_SIZE).toBe(10);
    expect(plan.chunkCount).toBe(3);
    expect(plan.chunks[0]).toHaveLength(10);
    expect(plan.chunks[2]).toHaveLength(5);
    expect(plan.total).toBe(25);
  });

  it("dedupes ids", () => {
    const plan = planOutreachBatches(["a", "a", "b"]);
    expect(plan.total).toBe(2);
    expect(plan.chunkCount).toBe(1);
  });
});
