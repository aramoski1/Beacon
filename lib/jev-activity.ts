// Reclassify a dumped "note" when the text is clearly a call, email, or meeting.

import { jevChoice, jevDecide, jevEnabled } from "@/lib/jev";

export const ACTIVITY_TYPES = ["letter", "email", "call", "note", "meeting"] as const;
export type ActivityKind = (typeof ACTIVITY_TYPES)[number];

export function pickActivityType(
  chosen: ActivityKind,
  jevType: string | null,
  confidence: number,
  minConfidence = 0.85,
): ActivityKind {
  if (chosen !== "note") return chosen;
  if (!jevType || jevType === "note" || jevType === "unspecified") return chosen;
  if (confidence < minConfidence) return chosen;
  return (ACTIVITY_TYPES as readonly string[]).includes(jevType)
    ? (jevType as ActivityKind)
    : chosen;
}

export async function jevRefineActivityType(
  chosen: ActivityKind,
  notes: string | null | undefined,
): Promise<ActivityKind> {
  const text = notes?.trim() ?? "";
  if (chosen !== "note" || text.length < 12 || !jevEnabled()) return chosen;

  const decided = await jevDecide(
    { notes: text.slice(0, 600) },
    {
      activity_type: {
        type: "choice",
        instructions:
          "What kind of CRM activity is this note describing? Keep note if it is just a memo.",
        criteria: {
          call: "A phone call happened",
          email: "An email was sent or received",
          meeting: "An in-person or video meeting",
          letter: "A physical letter or mailer",
          note: "A memo / reminder, not a completed touch",
        },
      },
    },
  );
  const pick = jevChoice(decided, "activity_type");
  return pickActivityType(chosen, pick?.choice ?? null, pick?.confidence ?? 0);
}
