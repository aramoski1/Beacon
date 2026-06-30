"use client";

import { useState } from "react";
import Link from "next/link";
import { Flame, Building2, X } from "lucide-react";
import { ComposeOutreach } from "@/components/compose-outreach";
import type { StaleTier1Owner } from "./actions";

export function StaleTier1OwnersPanel({
  items,
  userEmail,
}: {
  items: StaleTier1Owner[];
  userEmail: string | null | undefined;
}) {
  const [composingFor, setComposingFor] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">All Tier-1 owners contacted within 90 days.</p>
      </div>
    );
  }

  const active = composingFor ? items.find((c) => c.id === composingFor) : null;

  return (
    <div className="rounded-xl border bg-card overflow-hidden divide-y">
      {items.map((c) => (
        <div key={c.id}>
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="shrink-0 size-9 rounded-lg bg-orange-500/15 flex items-center justify-center">
              <Flame className="size-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Link
                href={`/contacts/${c.id}`}
                className="text-sm font-medium hover:underline underline-offset-2"
              >
                {c.name ?? "Unnamed"}
              </Link>
              {c.company && (
                <p className="text-xs text-muted-foreground truncate">{c.company}</p>
              )}
              {c.property_address && c.property_id && (
                <Link
                  href={`/properties/${c.property_id}`}
                  className="text-xs text-muted-foreground hover:text-foreground truncate flex items-center gap-1"
                >
                  <Building2 className="size-3 shrink-0" />
                  {c.property_address}
                </Link>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-semibold text-destructive tabular-nums">
                {c.daysSince >= 999 ? "never" : `${c.daysSince}d`}
              </p>
              <button
                onClick={() => setComposingFor(composingFor === c.id ? null : c.id)}
                className="text-[10px] text-primary hover:underline underline-offset-2 flex items-center gap-0.5"
              >
                {composingFor === c.id ? (
                  <><X className="size-2.5" />Close</>
                ) : (
                  "Compose →"
                )}
              </button>
            </div>
          </div>

          {composingFor === c.id && active && (
            <div className="px-4 pb-4 border-t bg-muted/20">
              <ComposeOutreach
                contactId={active.id}
                contactName={active.name}
                contactEmail={active.email}
                userEmail={userEmail}
                onSent={() => setComposingFor(null)}
                onDone={() => setComposingFor(null)}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
