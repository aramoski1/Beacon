"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { linkContactsToProperty, promotePropertyOwnerToCrm } from "@/app/crm/actions";

export function PromoteOwnerButton({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function promote() {
    setError(null);
    start(async () => {
      const res = await promotePropertyOwnerToCrm(propertyId);
      if (res.error) {
        setError(res.error);
        return;
      }
      const ids = [
        ...(res.contacts ?? []).map((c) => c.id),
        ...(res.unlinkedContacts ?? []).map((c) => c.id),
      ];
      const unique = [...new Set(ids)];
      if (unique.length > 0) {
        await linkContactsToProperty(propertyId, unique);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={promote} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
        Promote to CRM
      </Button>
      {error && <p className="text-[11px] text-destructive max-w-[16rem] text-right">{error}</p>}
    </div>
  );
}
