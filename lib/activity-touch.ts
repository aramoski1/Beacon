/**
 * Pure helpers: which activity types should bump contact cadence (last_contacted_at).
 */

export type TouchActivityType = "letter" | "email" | "call" | "note" | "meeting";

/** Notes and freeform journaling do not count as outreach touches. */
export function shouldBumpLastContacted(activityType: TouchActivityType): boolean {
  return activityType === "call"
    || activityType === "email"
    || activityType === "letter"
    || activityType === "meeting";
}

export type CallOutcome = "connected" | "left_vm" | "no_answer" | null;

export function formatCallOutcomeNote(outcome: CallOutcome, extra?: string | null): string {
  const parts: string[] = [];
  if (outcome === "connected") parts.push("Outcome: connected");
  else if (outcome === "left_vm") parts.push("Outcome: left voicemail");
  else if (outcome === "no_answer") parts.push("Outcome: no answer");
  if (extra?.trim()) parts.push(extra.trim());
  return parts.join(" — ") || "Call logged";
}
