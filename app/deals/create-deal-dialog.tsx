"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { X, Briefcase, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEAL_TYPES, DEAL_TYPE_LABELS, stagesForDealType, STAGE_LABELS, type DealStage, type DealType, type Deal } from "@/lib/deals";
import { createDeal, updateDeal } from "./actions";
import { appendTenantRepNotes } from "@/lib/deal-follow-up";

type Props = {
  /** If provided, locks the contact on the new deal. */
  contactId?: string;
  contactName?: string | null;
  /** If provided, locks the property on the new deal. */
  propertyId?: string;
  propertyAddress?: string | null;
  /** Open the dialog on mount (e.g. /deals?new=1). */
  defaultOpen?: boolean;
  /** Render a custom trigger; if omitted, a default "New pursuit" button is shown. */
  trigger?: React.ReactNode;
  onCreated?: (deal: Deal) => void;
  /** When provided, the dialog edits this deal instead of creating a new one. */
  deal?: Deal;
  onUpdated?: (deal: Deal) => void;
};

export function CreateDealDialog({
  contactId,
  contactName,
  propertyId,
  propertyAddress,
  defaultOpen = false,
  trigger,
  onCreated,
  deal,
  onUpdated,
}: Props) {
  const isEdit = !!deal;
  const [open, setOpen] = useState(defaultOpen);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dealType, setDealType] = useState<DealType>(deal?.deal_type ?? "tenant_rep");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  function defaultName() {
    if (deal) return deal.name;
    if (contactName) return `Pursuit — ${contactName}`;
    if (propertyAddress) return `Pursuit — ${propertyAddress}`;
    return "";
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const fd = new FormData(e.currentTarget);
    const name = fd.get("name") as string;
    const stage = fd.get("stage") as DealStage;
    const type = (fd.get("deal_type") as DealType) || dealType;
    const commissionRaw = fd.get("estimated_commission") as string;
    const estimated_commission = commissionRaw ? parseFloat(commissionRaw) : null;
    const next_action = fd.get("next_action") as string | null;
    const next_action_due = (fd.get("next_action_due") as string) || null;
    const expected_close_date = (fd.get("expected_close_date") as string) || null;
    const notes = fd.get("notes") as string | null;
    const target_sf = (fd.get("target_sf") as string) || null;
    const target_submarket = (fd.get("target_submarket") as string) || null;
    const timing = (fd.get("timing") as string) || null;

    const mergedNotes =
      type === "tenant_rep"
        ? appendTenantRepNotes(notes, { target_sf, target_submarket, timing })
        : notes || null;

    startTransition(async () => {
      const result = isEdit
        ? await updateDeal(deal!.id, {
            name,
            deal_type: type,
            stage: stage || "prospect",
            estimated_commission: estimated_commission ?? null,
            next_action: next_action || null,
            next_action_due: next_action_due || null,
            expected_close_date,
            notes: mergedNotes,
          })
        : await createDeal({
            name,
            deal_type: type,
            stage: stage || "prospect",
            contact_id: contactId ?? null,
            property_id: propertyId ?? null,
            estimated_commission: estimated_commission ?? null,
            next_action: next_action || null,
            next_action_due: next_action_due || null,
            expected_close_date,
            notes: mergedNotes,
          });

      if (result.fieldErrors) {
        const errs: Record<string, string> = {};
        for (const e of result.fieldErrors) errs[e.field] = e.message;
        setFieldErrors(errs);
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (isEdit) onUpdated?.(result.deal!);
      else onCreated?.(result.deal!);
    });
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <button
            type="button"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Briefcase className="size-4" />
            {isEdit ? "Edit pursuit" : "New pursuit"}
          </button>
        )}
      </span>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isPending && setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border bg-card shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b">
              <div className="flex items-center gap-2">
                <Briefcase className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">{isEdit ? "Edit pursuit" : "New pursuit"}</h2>
              </div>
              <button
                type="button"
                onClick={() => !isPending && setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
              {/* Context badges — pre-filled contact / property */}
              {(contactName || propertyAddress) && (
                <div className="flex flex-wrap gap-1.5">
                  {contactName && (
                    <span className="inline-flex items-center gap-1 text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20 rounded-full px-2.5 py-0.5">
                      Contact: {contactName}
                    </span>
                  )}
                  {propertyAddress && (
                    <span className="inline-flex items-center gap-1 text-xs bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-500/20 rounded-full px-2.5 py-0.5">
                      {propertyAddress}
                    </span>
                  )}
                </div>
              )}

              {!contactId && !propertyId && (
                <p className="text-xs text-amber-800 dark:text-amber-300 rounded-lg border border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2">
                  Tip: start from a contact or property page so this pursuit is linked.
                  You can still create it here — just harder to track who and which asset.
                </p>
              )}

              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="deal-name">
                  Deal name <span className="text-destructive">*</span>
                </label>
                <input
                  ref={nameRef}
                  id="deal-name"
                  name="name"
                  type="text"
                  defaultValue={defaultName()}
                  placeholder="e.g. Pursuit — 100 Brickell Ave"
                  className={cn(
                    "w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                    fieldErrors.name && "border-destructive focus:ring-destructive/50"
                  )}
                />
                {fieldErrors.name && (
                  <p className="text-xs text-destructive">{fieldErrors.name}</p>
                )}
              </div>

              {/* Deal type */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="deal-type">
                  Deal type
                </label>
                <select
                  id="deal-type"
                  name="deal_type"
                  value={dealType}
                  onChange={(e) => setDealType(e.target.value as DealType)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {DEAL_TYPES.map((t) => (
                    <option key={t} value={t}>{DEAL_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              {/* Stage */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="deal-stage">
                  Stage
                </label>
                <select
                  id="deal-stage"
                  name="stage"
                  defaultValue={deal?.stage ?? "prospect"}
                  key={dealType}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {stagesForDealType(dealType).map((s) => (
                    <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              {/* Three-column: commission + next action + expected close */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground" htmlFor="deal-commission">
                    Est. commission ($)
                  </label>
                  <input
                    id="deal-commission"
                    name="estimated_commission"
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={deal?.estimated_commission ?? undefined}
                    placeholder="e.g. 25000"
                    className={cn(
                      "w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                      fieldErrors.estimated_commission && "border-destructive"
                    )}
                  />
                  {fieldErrors.estimated_commission && (
                    <p className="text-xs text-destructive">{fieldErrors.estimated_commission}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground" htmlFor="deal-next-action-due">
                    Next action due
                  </label>
                  <input
                    id="deal-next-action-due"
                    name="next_action_due"
                    type="date"
                    defaultValue={deal?.next_action_due ?? undefined}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground" htmlFor="deal-expected-close">
                    Expected close
                  </label>
                  <input
                    id="deal-expected-close"
                    name="expected_close_date"
                    type="date"
                    defaultValue={deal?.expected_close_date ?? undefined}
                    className={cn(
                      "w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                      fieldErrors.expected_close_date && "border-destructive"
                    )}
                  />
                  {fieldErrors.expected_close_date && (
                    <p className="text-xs text-destructive">{fieldErrors.expected_close_date}</p>
                  )}
                </div>
              </div>

              {/* Next action */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="deal-next-action">
                  Next action
                </label>
                <input
                  id="deal-next-action"
                  name="next_action"
                  type="text"
                  defaultValue={deal?.next_action ?? undefined}
                  placeholder="e.g. Send tour proposal by Friday"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {dealType === "tenant_rep" && (
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                  <p className="text-[11px] text-muted-foreground">
                    Tenant-rep context (optional) — helps the pursuit read like a real requirement.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      name="target_sf"
                      type="text"
                      placeholder="Target SF"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <input
                      name="target_submarket"
                      type="text"
                      placeholder="Submarket"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <input
                      name="timing"
                      type="text"
                      placeholder="Timing"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="deal-notes">
                  Notes
                </label>
                <textarea
                  id="deal-notes"
                  name="notes"
                  rows={2}
                  defaultValue={deal?.notes ?? undefined}
                  placeholder="Any context for this pursuit…"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                  {error}
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => !isPending && setOpen(false)}
                  className="h-9 px-4 rounded-lg text-sm font-medium border border-border bg-background hover:bg-muted/60 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  {isEdit ? "Save changes" : "Create pursuit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
