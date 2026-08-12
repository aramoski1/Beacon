"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { createOwnerContact, createContactFromSunbizOwner } from "./actions";

type Mode =
  | { kind: "sunbiz"; personIndex: number }
  | { kind: "mdpa" };

export function OwnerContactCreateButton({
  propertyId,
  mode,
  alreadyLinked,
}: {
  propertyId: string;
  mode: Mode;
  alreadyLinked: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(alreadyLinked);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600 shrink-0">
        <CheckCircle2 className="size-3.5" /> In CRM
      </span>
    );
  }

  function handleClick() {
    setPending(true);
    setError(null);
    startTransition(async () => {
      const result =
        mode.kind === "sunbiz"
          ? await createContactFromSunbizOwner(propertyId, mode.personIndex)
          : await createOwnerContact(propertyId);
      setPending(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1 shrink-0">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
        Create contact
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
