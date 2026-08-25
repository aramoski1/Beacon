"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "red" | "amber" | "none";

const ACCENT_CLS: Record<Accent, string> = {
  red: "border-red-500/30 bg-red-50/95 dark:bg-red-950/90",
  amber: "border-amber-500/30 bg-amber-50/95 dark:bg-amber-950/90",
  none: "border-border bg-background/95",
};

const ACCENT_ICON_CLS: Record<Accent, string> = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-700 dark:text-amber-400",
  none: "",
};

const ACCENT_LABEL_CLS: Record<Accent, string> = {
  red: "text-destructive",
  amber: "text-amber-700 dark:text-amber-400",
  none: "",
};

/**
 * Shared sticky section header used by Lease radar, Outreach, and Follow-ups
 * so the three action-queue pages share one visual language for "here's a
 * group of things, here's how many" instead of three different treatments.
 * `collapsible` controls whether it's a real toggle button (Lease radar,
 * Follow-ups — where hiding a section reduces scroll) or a static label
 * (Outreach — where sections stay open because bulk-selecting checkboxes
 * across sections is the point of the page).
 */
export function SectionHeader({
  label,
  count,
  subLabel,
  accent = "none",
  collapsible = false,
  open = true,
  onToggle,
  stickyOffset = "top-0",
}: {
  label: string;
  count: number;
  subLabel?: string;
  /** "red" for overdue-type urgency, "amber" for due-today-type, "none" otherwise. */
  accent?: Accent;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** Tailwind sticky offset class — lets a page stack this below its own fixed toolbar. */
  stickyOffset?: string;
}) {
  const shared = cn(
    "sticky z-10 w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 border text-left backdrop-blur-sm",
    stickyOffset,
    ACCENT_CLS[accent],
  );

  const content = (
    <>
      <div className="min-w-0">
        <h2 className={cn("text-sm font-semibold flex items-center gap-2", ACCENT_LABEL_CLS[accent])}>
          {accent === "red" && <AlertTriangle className={cn("size-3.5 shrink-0", ACCENT_ICON_CLS[accent])} />}
          {label}
          <span className="rounded-full bg-background border px-2 py-0.5 text-[10px] font-bold tabular-nums text-foreground">
            {count}
          </span>
        </h2>
        {subLabel && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subLabel}</p>}
      </div>
      {collapsible && (
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      )}
    </>
  );

  if (!collapsible) {
    return <div className={shared}>{content}</div>;
  }

  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className={shared}>
      {content}
    </button>
  );
}
