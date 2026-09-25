// Fuzzy same-property identity. Exact address / source_url stay in
// lib/property-ingest.ts. Jev only picks among street-number candidates.

import { jevChoice, jevDecide, jevEnabled } from "@/lib/jev";

export function streetNumber(address: string | null | undefined): string | null {
  const m = address?.trim().match(/^(\d+[a-z]?)\b/i);
  return m?.[1] ?? null;
}

export type PropertyIdentityCandidate = {
  id: string;
  address: string | null;
  city: string | null;
};

export function pickDuplicateFromChoice(
  choice: string | null,
  confidence: number,
  candidateIds: string[],
  minConfidence = 0.85,
): string | null {
  if (!choice || choice === "none" || confidence < minConfidence) return null;
  return candidateIds.includes(choice) ? choice : null;
}

export async function jevPickDuplicateId(
  incomingAddress: string,
  incomingCity: string | null,
  candidates: PropertyIdentityCandidate[],
): Promise<string | null> {
  if (!jevEnabled() || candidates.length === 0) return null;
  const ids = candidates.map((c) => c.id);
  const decided = await jevDecide(
    {
      incoming: { address: incomingAddress, city: incomingCity },
      candidates: candidates.map((c) => ({
        id: c.id,
        address: c.address,
        city: c.city,
      })),
    },
    {
      same_property: {
        type: "choice",
        instructions:
          "Which existing property is the same parcel as the incoming address? Choose none unless the street number AND street name clearly match (suite/unit differences are OK). Different buildings on the same numbered street are none.",
        criteria: Object.fromEntries([
          ...candidates.map((c) => [c.id, c.address ?? c.id]),
          ["none", "A different property"],
        ]),
      },
    },
  );
  const pick = jevChoice(decided, "same_property");
  return pickDuplicateFromChoice(pick?.choice ?? null, pick?.confidence ?? 0, ids);
}
