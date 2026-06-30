"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { checkOwnershipChange } from "./actions";

export function OwnershipCheckPanel({ propertyId }: { propertyId: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "unchanged" | "changed" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  function handleCheck() {
    setStatus("idle");
    setErrorMsg(null);
    startTransition(async () => {
      const res = await checkOwnershipChange(propertyId);
      if ("error" in res) {
        setErrorMsg(res.error);
        setStatus("error");
        return;
      }
      if (res.changed) {
        setStatus("changed");
        router.refresh();
      } else {
        setStatus("unchanged");
      }
    });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={handleCheck}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {isPending
          ? <Loader2 className="size-3 animate-spin" />
          : <RefreshCw className="size-3" />}
        Re-check ownership
      </button>
      {status === "unchanged" && (
        <span className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="size-3" />
          No ownership changes detected
        </span>
      )}
      {status === "changed" && (
        <span className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="size-3" />
          Change detected — see alert above
        </span>
      )}
      {status === "error" && (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="size-3" />
          {errorMsg}
        </span>
      )}
    </div>
  );
}
