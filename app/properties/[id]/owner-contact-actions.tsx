"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { createOwnerContact, createContactFromSunbizOwner } from "./actions";
import { linkContactsToProperty } from "@/app/crm/actions";
import { LinkToPropertyDialog } from "@/components/link-to-property-dialog";

type Mode =
  | { kind: "sunbiz"; personIndex: number }
  | { kind: "mdpa" };

export function OwnerContactCreateButton({
  propertyId,
  propertyLabel,
  contactName,
  mode,
  alreadyLinked,
}: {
  propertyId: string;
  propertyLabel?: string | null;
  contactName?: string | null;
  mode: Mode;
  alreadyLinked: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(alreadyLinked);
  const [error, setError] = useState<string | null>(null);
  const [linkConfirm, setLinkConfirm] = useState<{ contactId: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

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
      setLinkConfirm({ contactId: result.id! });
    });
  }

  async function handleConfirmLink() {
    if (!linkConfirm) return;
    setLinkBusy(true);
    const linkRes = await linkContactsToProperty(propertyId, [linkConfirm.contactId]);
    setLinkBusy(false);
    setLinkConfirm(null);
    if (linkRes.error) setError(`Contact created, but linking failed: ${linkRes.error}`);
    router.refresh();
  }

  function handleCancelLink() {
    setLinkConfirm(null);
    router.refresh();
  }

  if (done) {
    return (
      <span className="inline-flex flex-col items-start gap-1 shrink-0">
        <span className="inline-flex items-center gap-1 text-xs text-green-600 shrink-0">
          <CheckCircle2 className="size-3.5" /> In CRM
        </span>
        {error && <span className="text-xs text-destructive">{error}</span>}
        {linkConfirm && (
          <LinkToPropertyDialog
            contactLabel={contactName ?? "this contact"}
            propertyLabel={propertyLabel ?? "this property"}
            busy={linkBusy}
            onCancel={handleCancelLink}
            onConfirm={handleConfirmLink}
          />
        )}
      </span>
    );
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
