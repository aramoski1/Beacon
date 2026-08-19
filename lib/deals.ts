/** Pure types, validation, and helpers for the deals/pursuit pipeline. */

export const DEAL_TYPES = ["tenant_rep", "listing", "investment_sale"] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  tenant_rep: "Tenant rep",
  listing: "Listing",
  investment_sale: "Investment sale",
};

export const DEAL_STAGES = [
  "prospect",
  "contacted",
  "meeting",
  "requirement",
  "proposal",
  "won",
  "loi_sent",
  "loi_executed",
  "lease_drafting",
  "lease_signed",
  "psa_signed",
  "due_diligence",
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
  /** Tenant-rep: mandate won / search live — still an active pursuit until Closed. */
  won: "Won (active)",
  loi_sent: "LOI Sent",
  loi_executed: "LOI Executed",
  lease_drafting: "Lease Drafting",
  lease_signed: "Lease Signed",
  psa_signed: "PSA Signed",
  due_diligence: "Due Diligence",
  under_contract: "Under Contract",
  closed: "Closed",
  lost: "Lost",
};

/** Ordered stage set appropriate to each deal type (kanban columns). */
export const STAGES_BY_DEAL_TYPE: Record<DealType, readonly DealStage[]> = {
  tenant_rep: [
    "prospect",
    "contacted",
    "meeting",
    "requirement",
    "proposal",
    "won",
    "loi_sent",
    "loi_executed",
    "lease_drafting",
    "lease_signed",
    "closed",
    "lost",
  ],
  listing: [
    "prospect",
    "contacted",
    "meeting",
    "proposal",
    "loi_sent",
    "loi_executed",
    "lease_drafting",
    "lease_signed",
    "under_contract",
    "closed",
    "lost",
  ],
  investment_sale: [
    "prospect",
    "contacted",
    "meeting",
    "proposal",
    "loi_sent",
    "loi_executed",
    "psa_signed",
    "due_diligence",
    "under_contract",
    "closed",
    "lost",
  ],
};

export function stagesForDealType(dealType: DealType | null | undefined): readonly DealStage[] {
  if (dealType && dealType in STAGES_BY_DEAL_TYPE) {
    return STAGES_BY_DEAL_TYPE[dealType];
  }
  return DEAL_STAGES;
}

export function isStageAllowedForType(
  stage: DealStage,
  dealType: DealType | null | undefined,
): boolean {
  return (stagesForDealType(dealType) as readonly string[]).includes(stage);
}

export function defaultStageForType(dealType: DealType): DealStage {
  return stagesForDealType(dealType)[0] ?? "prospect";
}

/**
 * Truly done pursuits — drop out of active pipeline / dashboard KPIs.
 * under_contract and tenant-rep "won" stay ACTIVE (still working the deal).
 */
export const TERMINAL_STAGES: readonly DealStage[] = ["closed", "lost"];
export const ACTIVE_STAGES: DealStage[] = DEAL_STAGES.filter(
  (s) => !TERMINAL_STAGES.includes(s)
);

export function isTerminalStage(stage: DealStage): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export function isActiveStage(stage: DealStage): boolean {
  return !isTerminalStage(stage);
}

export const STAGE_COLORS: Record<DealStage, string> = {
  prospect: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20",
  contacted: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  meeting: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  requirement: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  proposal: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  loi_sent: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  loi_executed: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  lease_drafting: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-500/20",
  lease_signed: "bg-lime-500/10 text-lime-700 dark:text-lime-400 border-lime-500/20",
  psa_signed: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  due_diligence: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  under_contract: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  closed: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  lost: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
};

/** Rough historical close probability per stage, used for weighted pipeline forecasting. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  prospect: 5,
  contacted: 10,
  meeting: 20,
  requirement: 25,
  proposal: 35,
  won: 45,
  loi_sent: 55,
  loi_executed: 65,
  psa_signed: 72,
  lease_drafting: 75,
  due_diligence: 80,
  lease_signed: 90,
  under_contract: 90,
  closed: 100,
  lost: 0,
};

export type DealCustomFields = Record<string, string | number | null>;

export type Deal = {
  id: string;
  owner_id: string;
  name: string;
  stage: DealStage;
  deal_type: DealType;
  contact_id: string | null;
  property_id: string | null;
  estimated_commission: number | null;
  notes: string | null;
  next_action: string | null;
  next_action_due: string | null;
  expected_close_date: string | null;
  custom_fields: DealCustomFields | null;
  created_at: string;
  updated_at: string;
  contacts?: { name: string | null; company: string | null } | null;
  properties?: { address: string | null; city: string | null } | null;
};

export type CreateDealInput = {
  name: string;
  stage?: DealStage;
  deal_type?: DealType;
  contact_id?: string | null;
  property_id?: string | null;
  estimated_commission?: number | null;
  notes?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
  expected_close_date?: string | null;
  custom_fields?: DealCustomFields | null;
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
  const dealType = input.deal_type ?? "tenant_rep";
  if (!(DEAL_TYPES as readonly string[]).includes(dealType)) {
    errors.push({ field: "deal_type", message: "Invalid deal type." });
  }
  if (input.stage != null) {
    if (!(DEAL_STAGES as readonly string[]).includes(input.stage)) {
      errors.push({ field: "stage", message: "Invalid stage." });
    } else if (!isStageAllowedForType(input.stage, dealType)) {
      errors.push({ field: "stage", message: "Stage is not used for this deal type." });
    }
  }
  if (
    input.estimated_commission != null &&
    (isNaN(Number(input.estimated_commission)) || Number(input.estimated_commission) < 0)
  ) {
    errors.push({ field: "estimated_commission", message: "Commission must be a positive number." });
  }
  if (input.expected_close_date != null && isNaN(Date.parse(input.expected_close_date))) {
    errors.push({ field: "expected_close_date", message: "Expected close date is invalid." });
  }
  return errors;
}

export function nextStage(
  stage: DealStage,
  dealType?: DealType | null,
): DealStage | null {
  const stages = stagesForDealType(dealType);
  const idx = stages.indexOf(stage);
  return idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : null;
}

export function prevStage(
  stage: DealStage,
  dealType?: DealType | null,
): DealStage | null {
  const stages = stagesForDealType(dealType);
  const idx = stages.indexOf(stage);
  return idx > 0 ? stages[idx - 1] : null;
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
