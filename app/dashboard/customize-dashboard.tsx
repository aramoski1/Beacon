"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MODULE_GROUPS,
  MODULE_LABELS,
  DEFAULT_VISIBLE,
  type ModuleId,
} from "@/lib/dashboard-layout";
import { saveDashboardLayout, resetDashboardLayout } from "./actions";
import { useDashboardVisible } from "./dashboard-visibility";

/**
 * Dashboard show/hide customization. Visibility only — no drag-and-drop, no
 * reordering; Beacon's fixed section order never changes. Every dashboard
 * section is in the catalog, including Command center and Ask Beacon. The
 * Customize button itself is not hideable, so a broker can always restore
 * what they turned off.
 *
 * Self-contained: manages its own open/close state, so it can be dropped in
 * at more than one spot on the page (the main trigger near the hero, and a
 * compact "Customize" link inside the empty-primary hint) without any shared
 * state between the two instances.
 */
export function DashboardCustomize({
  initialVisible,
  variant = "button",
}: {
  initialVisible: Record<ModuleId, boolean>;
  variant?: "button" | "hint";
}) {
  const router = useRouter();
  const { visible, setVisible } = useDashboardVisible();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<ModuleId, boolean>>(initialVisible);
  const [openedFrom, setOpenedFrom] = useState<Record<ModuleId, boolean>>(initialVisible);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setDraft(visible);
    setOpenedFrom(visible);
    setError(null);
    setOpen(true);
  }

  function closeSheet() {
    if (saving) return;
    setVisible(openedFrom);
    setOpen(false);
  }

  function toggle(id: ModuleId) {
    setDraft((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      setVisible(next);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await saveDashboardLayout(draft);
    setSaving(false);
    if ("error" in res) { setError(res.error); return; }
    setVisible(draft);
    setOpen(false);
    router.refresh();
  }

  async function handleReset() {
    setSaving(true);
    setError(null);
    const res = await resetDashboardLayout();
    setSaving(false);
    if ("error" in res) { setError(res.error); return; }
    const next = { ...DEFAULT_VISIBLE };
    setDraft(next);
    setVisible(next);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      {variant === "hint" ? (
        <button
          type="button"
          onClick={openSheet}
          className="text-xs font-medium text-primary hover:underline underline-offset-2"
        >
          Customize dashboard
        </button>
      ) : (
        <button
          type="button"
          onClick={openSheet}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Settings2 className="size-3.5" />
          Customize
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => closeSheet()}
          />
          <div className="relative z-10 w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border bg-card shadow-xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b shrink-0">
              <div className="flex items-center gap-2">
                <Settings2 className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Customize dashboard</h2>
              </div>
              <button
                type="button"
                onClick={() => closeSheet()}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5 overflow-y-auto">
              <p className="text-xs text-muted-foreground">
                Show or hide any dashboard section. Order never changes. Customize
                always stays so you can restore what you hid.
              </p>

              {MODULE_GROUPS.map((group) => (
                <div key={group.id} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {group.moduleIds.map((id) => (
                      <label
                        key={id}
                        className="flex items-center gap-2 py-1 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={draft[id]}
                          onChange={() => toggle(id)}
                          className="size-4 rounded border-border accent-primary cursor-pointer shrink-0"
                        />
                        <span className={cn(!draft[id] && "text-muted-foreground")}>
                          {MODULE_LABELS[id]}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {error && (
                <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t shrink-0">
              <button
                type="button"
                onClick={handleReset}
                disabled={saving}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
              >
                Reset to default
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => closeSheet()}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors text-muted-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
