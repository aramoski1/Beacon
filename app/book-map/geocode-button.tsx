"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { geocodeMissingProperties } from "./geocode-actions";

export function GeocodeBookButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          start(async () => {
            const res = await geocodeMissingProperties(20);
            setMsg(`Geocoded ${res.geocoded} · ${res.failed} failed · ${res.remaining} remaining`);
          });
        }}
        className="text-xs font-medium rounded-md border px-3 py-1.5 hover:bg-muted/50 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin inline mr-1" /> : null}
        Geocode missing pins
      </button>
      {msg && <span className="text-[11px] text-muted-foreground">{msg}</span>}
    </div>
  );
}
