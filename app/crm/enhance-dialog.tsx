"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react";
import { MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountyEnhanceContent } from "@/app/properties/[id]/enhance-section";

export function EnhanceDialog({
  propertyId,
  propertyAddress,
  onEnhanced,
}: {
  propertyId: string;
  propertyAddress: string | null;
  onEnhanced?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  function handleDone(count: number) {
    setDone(true);
    if (count > 0) onEnhanced?.();
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setDone(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger render={
        <button
          title="Enhance with county data"
          className="crm-row-action text-blue-500 hover:text-blue-700"
        >
          <MapPin className="size-3.5" />
        </button>
      } />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0 duration-150" />
        <Dialog.Popup className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border bg-background shadow-xl p-6 space-y-4 animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <MapPin className="size-4 text-blue-600" />
                Enhance with county data
              </h2>
              {propertyAddress && (
                <p className="text-xs text-muted-foreground mt-0.5">{propertyAddress}</p>
              )}
            </div>
            <Dialog.Close render={
              <button className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
                <X className="size-4" />
              </button>
            } />
          </div>

          {done ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                County data applied. Reload the CRM to see updated values.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => window.location.reload()}>
                  Reload now
                </Button>
                <Dialog.Close render={
                  <Button size="sm" variant="ghost">Close</Button>
                } />
              </div>
            </div>
          ) : (
            <CountyEnhanceContent propertyId={propertyId} onDone={handleDone} />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
