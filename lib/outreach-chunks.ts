/** Chunk contact IDs for batch outreach (one personalized email per contact). */

export const OUTREACH_CHUNK_SIZE = 10;

export function chunkIds<T>(items: T[], size = OUTREACH_CHUNK_SIZE): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export type OutreachBatchPlan = {
  chunks: string[][];
  total: number;
  chunkCount: number;
};

export function planOutreachBatches(
  contactIds: string[],
  chunkSize = OUTREACH_CHUNK_SIZE,
): OutreachBatchPlan {
  const unique = [...new Set(contactIds.filter(Boolean))];
  const chunks = chunkIds(unique, chunkSize);
  return {
    chunks,
    total: unique.length,
    chunkCount: chunks.length,
  };
}
