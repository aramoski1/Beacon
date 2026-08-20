"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { acceptInvitation } from "./actions";

export function AcceptButton({ token, firmName }: { token: string; firmName: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation(token);
      if (result.error) { setError(result.error); return; }
      router.push("/crm");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleAccept}
        disabled={isPending}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {isPending && <Loader2 className="size-4 animate-spin" />}
        Join {firmName ?? "this team"}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
