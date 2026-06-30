"use client";

import { useTransition, useState } from "react";
import { Loader2, UserCheck } from "lucide-react";
import { setLeaseTenant } from "./actions";

type ContactOption = {
  id: string;
  name: string | null;
  company: string | null;
  role: string | null;
};

export function TenantSelector({
  leaseId,
  currentContactId,
  contacts,
}: {
  leaseId: string;
  currentContactId: string | null;
  contacts: ContactOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const contactId = e.target.value || null;
    setError(null);
    startTransition(async () => {
      const res = await setLeaseTenant(leaseId, contactId);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <select
          defaultValue={currentContactId ?? ""}
          onChange={handleChange}
          disabled={isPending}
          className="text-sm border border-border rounded-md px-3 py-1.5 bg-background outline-none focus:ring-2 ring-ring disabled:opacity-60 max-w-xs"
        >
          <option value="">— No tenant linked —</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? "Unnamed"}{c.role ? ` · ${c.role}` : ""}{c.company ? ` (${c.company})` : ""}
            </option>
          ))}
        </select>
        {isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />}
        {!isPending && currentContactId && <UserCheck className="size-3.5 text-green-600 shrink-0" />}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {contacts.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No contacts linked to this property yet — add a tenant contact on the property page first.
        </p>
      )}
    </div>
  );
}
