"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BeaconBrand } from "@/components/beacon-logo";
import { acceptPilotAgreement } from "./actions";
import { signOut } from "@/app/login/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Accept and continue"}
    </Button>
  );
}

export default function PilotAgreementPage() {
  const [state, action] = useActionState(acceptPilotAgreement, null);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-2">
            <BeaconBrand logoClassName="size-9" className="gap-3 [&>span]:text-xl" />
          </div>
          <h1 className="text-lg font-semibold mt-2">Pilot agreement</h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Beacon is in private pilot. By continuing you agree not to share access,
            screenshots of other brokers&apos; data, or confidential product details
            outside your firm without written permission.
          </p>
        </div>

        <form action={action} className="space-y-4">
          <label className="flex items-start gap-2.5 text-sm leading-relaxed cursor-pointer">
            <input
              type="checkbox"
              name="pilot_agreement"
              required
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              I agree to the Beacon pilot terms. I understand this is pre-production
              software and my book stays private to my account unless I share a record
              with teammates.
            </span>
          </label>

          {state && "error" in state && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <SubmitButton />
        </form>

        <div className="flex justify-center gap-3 text-xs text-muted-foreground">
          <Link href="/how-beacon-works?from=pilot" className="underline underline-offset-4">
            How Beacon works
          </Link>
          <form action={signOut}>
            <button type="submit" className="underline underline-offset-4">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
