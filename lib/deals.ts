/** Pure types, validation, and helpers for the deals/pursuit pipeline. */

export const DEAL_STAGES = [
  "prospect",
  "contacted",
  "meeting",
  "requirement",
  "proposal",
  "won",
  "under_contract",
  "closed",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const STAGE_LABELS: Record<DealStage, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  meeting: "Meeting",
  requirement: "Requirement",
  proposal: "Proposal",
  won: "Won",
  under_contract: "Under Contract",
  closed: "Closed",
  lost: "Lost",
};

export const TERMINAL_STAGES: readonly DealStage[] = ["won", "under_contract", "closed", "lost"];
export const ACTIVE_STAGES: DealStage[] = DEAL_STAGES.filter(
  (s) => !TERMINAL_STAGES.includes(s)
);

export const STAGE_COLORS: Record<DealStage, string> = {
  prospect: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20",
  contacted: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  meeting: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  requirement: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  proposal: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  under_contract: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  closed: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  lost: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
};

export type Deal = {
  id: string;
  owner_id: string;
  name: string;
  stage: DealStage;
  contact_id: string | null;
  property_id: string | null;
  estimated_commission: number | null;
  notes: string | null;
  next_action: string | null;
  next_action_due: string | null;
  created_at: string;
  updated_at: string;
  contacts?: { name: string | null; company: string | null } | null;
  properties?: { address: string | null; city: string | null } | null;
};

export type CreateDealInput = {
  name: string;
  stage?: DealStage;
  contact_id?: string | null;
  property_id?: string | null;
  estimated_commission?: number | null;
  notes?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
};

export type ValidationError = { field: string; message: string };

export function validateCreateDeal(input: Partial<CreateDealInput>): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = input.name?.trim() ?? "";
  if (!name) {
    errors.push({ field: "name", message: "Deal name is required." });
  } else if (name.length > 200) {
    errors.push({ field: "name", message: "Deal name must be 200 characters or fewer." });
  }
  if (input.stage != null && !(DEAL_STAGES as readonly string[]).includes(input.stage)) {
    errors.push({ field: "stage", message: "Invalid stage." });
  }
  if (
    input.estimated_commission != null &&
    (isNaN(Number(input.estimated_commission)) || Number(input.estimated_commission) < 0)
  ) {
    errors.push({ field: "estimated_commission", message: "Commission must be a positive number." });
  }
  return errors;
}

export function nextStage(stage: DealStage): DealStage | null {
  const idx = DEAL_STAGES.indexOf(stage);
  return idx >= 0 && idx < DEAL_STAGES.length - 1 ? DEAL_STAGES[idx + 1] : null;
}

export function prevStage(stage: DealStage): DealStage | null {
  const idx = DEAL_STAGES.indexOf(stage);
  return idx > 0 ? DEAL_STAGES[idx - 1] : null;
}

export function isDealStale(deal: Deal, staleDays = 14): boolean {
  if ((TERMINAL_STAGES as readonly string[]).includes(deal.stage)) return false;
  return daysInStage(deal) >= staleDays;
}

export function daysInStage(deal: Deal): number {
  return Math.floor((Date.now() - new Date(deal.updated_at).getTime()) / 86_400_000);
}

export function fmtCommission(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}
