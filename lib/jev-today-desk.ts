// Optional Jev blend on the Today desk. Deterministic scores stay in
// lib/today-desk.ts. Jev may nudge cadence / follow-up / deal rows only;
// lease, notice, 1031, and ownership ranks are left alone.

import { jevDecide, jevEnabled, jevScore, type JevQuestion } from "@/lib/jev";
import type { TodayDeskItem, TodayDeskKind } from "@/lib/today-desk";

const SOFT_KINDS = new Set<TodayDeskKind>(["outreach", "follow_up", "deal_due"]);
const MAX_SCORED = 8;

export function blendTodayDeskScores(
  items: TodayDeskItem[],
  jevById: Record<string, number>,
): TodayDeskItem[] {
  const blended = items.map((item) => {
    if (!SOFT_KINDS.has(item.kind)) return item;
    const j = jevById[item.id];
    if (typeof j !== "number" || Number.isNaN(j)) return item;
    const clamped = Math.min(1, Math.max(0, j));
    const next = Math.round(item.score + (clamped - 0.5) * 16);
    return { ...item, score: Math.min(50, Math.max(0, next)) };
  });
  return blended.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export async function refineTodayDeskItems(items: TodayDeskItem[]): Promise<TodayDeskItem[]> {
  if (!jevEnabled() || items.length === 0) return items;
  const soft = items.filter((i) => SOFT_KINDS.has(i.kind)).slice(0, MAX_SCORED);
  if (soft.length === 0) return items;

  const questions: Record<string, JevQuestion> = {};
  for (const item of soft) {
    questions[item.id] = {
      type: "score",
      instructions:
        "How important is this row for a commercial broker's morning queue today? 1 = do this first among cadence/follow-up/deal work; 0 = can wait.",
      criteria: ["time-sensitive", "relationship risk", "money in motion"],
    };
  }

  const state = {
    items: soft.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      why: i.why,
      due: i.dueDate ?? null,
    })),
  };

  const decided = await jevDecide(state, questions);
  if (!decided) return items;

  const jevById: Record<string, number> = {};
  for (const item of soft) {
    const s = jevScore(decided, item.id);
    if (s != null) jevById[item.id] = s;
  }
  if (Object.keys(jevById).length === 0) return items;
  return blendTodayDeskScores(items, jevById);
}
