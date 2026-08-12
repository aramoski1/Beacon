"use client";

import { Loader2 } from "lucide-react";

/** Small confirm modal asking whether to link one or more newly-created contacts to a property. */
export function LinkToPropertyDialog({
  contactLabel,
  propertyLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  contactLabel: string;
  propertyLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div className="bg-background rounded-xl border shadow-xl w-full max-w-sm p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold">Link to property</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Link {contactLabel} to {propertyLabel}?
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Linking…
              </>
            ) : (
              "Link contact"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
