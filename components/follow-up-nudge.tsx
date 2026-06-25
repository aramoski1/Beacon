"use client";

import { useState, useTransition } from "react";
import { CalendarDays, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createFollowUp } from "@/app/follow-ups/actions";

export function FollowUpNudge({
  contactId,
  propertyId,
  suggestedDays = 14,
  onDone,
}: {
  contactId: string;
  propertyId?: string;
  suggestedDays?: number;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const defaultDate = new Date(Date.now() + suggestedDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [date, setDate] = useState(defaultDate);

  function handleSet() {
    startTransition(async () => {
      await createFollowUp({
        contact_id:  contactId,
        property_id: propertyId ?? null,
        due_date:    date,
        description: "Follow up",
      });
      setDone(true);
      setTimeout(onDone, 700);
    });
  }

  if (done) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-600 py-1.5">
        <CheckCircle2 className="size-3.5" />
        Follow-up set
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
      <CalendarDays className="size-3.5 text-primary shrink-0" />
      <span className="text-xs font-medium text-primary">Set next follow-up?</span>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        disabled={isPending}
        className="border border-border rounded px-2 py-0.5 text-xs bg-background outline-none focus:ring-1 ring-ring"
      />
      <Button size="sm" className="h-6 px-2 text-xs" onClick={handleSet} disabled={isPending}>
        {isPending ? <Loader2 className="size-3 animate-spin" /> : "Set"}
      </Button>
      <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
        Skip
      </button>
    </div>
  );
}
