"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { runOwnershipWatchBatch } from "@/app/properties/[id]/actions";

export function OwnershipWatchBatchButton() {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            const res = await runOwnershipWatchBatch(15);
            setMsg(
              `Checked ${res.checked} · ${res.changed} flip${res.changed === 1 ? "" : "s"}` +
                (res.errors.length ? ` · ${res.errors.length} error(s)` : ""),
            );
            router.refresh();
          });
        }}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline underline-offset-2 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
        Re-check watch list
      </button>
      {msg && <span className="text-[10px] text-muted-foreground">{msg}</span>}
    </div>
  );
}
