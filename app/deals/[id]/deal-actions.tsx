"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CreateDealDialog } from "../create-deal-dialog";
import { deleteDeal } from "../actions";
import type { Deal } from "@/lib/deals";

export function DealActions({ deal }: { deal: Deal }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDeal(deal.id);
      if (!result.error) {
        router.push("/deals");
        router.refresh();
      }
      setConfirming(false);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <CreateDealDialog
        deal={deal}
        onUpdated={() => router.refresh()}
        trigger={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border hover:bg-muted/60 transition-colors"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
        }
      />
      <a
        href={`/api/export/loi?deal=${deal.id}`}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border hover:bg-muted/60 transition-colors"
      >
        Download LOI
      </a>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-muted-foreground border border-border hover:text-destructive hover:bg-destructive/10 transition-colors"
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        Delete
      </button>
      {confirming && (
        <ConfirmDialog
          title="Delete pursuit"
          message={`Delete "${deal.name}"? This removes its documents, activity, and follow-ups too. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
