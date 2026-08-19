export function formatDealFollowUpDescription(
  dealName: string,
  nextAction: string | null | undefined,
): string {
  const action = nextAction?.trim() || "Next action due";
  return `${dealName} — ${action}`;
}

/** Soft fields encouraged for tenant_rep (never hard-required). */
export type TenantRepSoftFields = {
  target_sf?: string | null;
  target_submarket?: string | null;
  timing?: string | null;
};

export function appendTenantRepNotes(
  notes: string | null | undefined,
  soft: TenantRepSoftFields,
): string | null {
  const lines: string[] = [];
  if (soft.target_sf?.trim()) lines.push(`Target SF: ${soft.target_sf.trim()}`);
  if (soft.target_submarket?.trim()) lines.push(`Submarket: ${soft.target_submarket.trim()}`);
  if (soft.timing?.trim()) lines.push(`Timing: ${soft.timing.trim()}`);
  if (lines.length === 0) return notes?.trim() || null;
  const block = lines.join("\n");
  const base = notes?.trim();
  return base ? `${base}\n\n${block}` : block;
}
