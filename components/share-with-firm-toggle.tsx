"use client";

import { useState } from "react";
import { Users, Lock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** The seven tables Beacon_Team_Multitenancy_Plan.md resolved decision #3 gave a `visibility` column. */
export type ShareableTable = "properties" | "contacts" | "lease_abstracts" | "deals" | "activities" | "follow_ups" | "documents";

/**
 * Beacon_Team_Multitenancy_Plan.md §3.1 resolved decision — private by
 * default, shared explicitly. This is that explicit action: only the
 * record's actual owner sees a toggle at all (a teammate sees a plain
 * "Shared with your team" label instead — flipping it back to private
 * isn't their call), and it only renders in a multi-member firm at all
 * (§7.3 — a solo broker never sees any of this).
 */
export function ShareWithFirmToggle({
  table,
  id,
  ownerId,
  currentUserId,
  initialVisibility,
  isSoloFirm,
}: {
  table: ShareableTable;
  id: string;
  ownerId: string;
  currentUserId: string;
  initialVisibility: "private" | "team";
  isSoloFirm: boolean;
}) {
  const [visibility, setVisibility] = useState(initialVisibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSoloFirm) return null;

  if (ownerId !== currentUserId) {
    return visibility === "team" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Users className="size-3" />
        Shared with your team
      </span>
    ) : null;
  }

  async function toggle() {
    const next = visibility === "team" ? "private" : "team";
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.from(table).update({ visibility: next }).eq("id", id);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setVisibility(next);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
          visibility === "team"
            ? "bg-primary/10 text-primary hover:bg-primary/15"
            : "bg-muted text-muted-foreground hover:bg-muted/70",
        )}
        title={visibility === "team" ? "Visible to your whole firm — click to make private again" : "Only visible to you — click to share with your firm"}
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" />
        ) : visibility === "team" ? (
          <Users className="size-3" />
        ) : (
          <Lock className="size-3" />
        )}
        {visibility === "team" ? "Shared with team" : "Private"}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
