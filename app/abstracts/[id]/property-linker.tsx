"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Loader2, Building2, X, Search, CheckCircle2 } from "lucide-react";
import { setLeaseProperty } from "./actions";
import { searchPropertiesForPicker } from "../new/actions";

type PropertyOption = {
  id: string;
  address: string;
  city: string | null;
};

export function PropertyLinker({
  leaseId,
  currentProperty,
}: {
  leaseId: string;
  currentProperty: PropertyOption | null;
}) {
  const [linked, setLinked] = useState<PropertyOption | null>(currentProperty);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PropertyOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      const r = await searchPropertiesForPicker(q);
      setResults(r);
      setSearching(false);
      setOpen(r.length > 0);
    }, 250);
  }

  async function link(prop: PropertyOption | null) {
    setError(null);
    setSaving(true);
    const res = await setLeaseProperty(leaseId, prop?.id ?? null);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setLinked(prop);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      {linked && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3 mb-2">
          <Building2 className="size-4 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <Link
              href={`/properties/${linked.id}`}
              className="text-sm font-medium hover:underline underline-offset-2"
            >
              {linked.address}
            </Link>
            {linked.city && (
              <p className="text-xs text-muted-foreground">{linked.city}</p>
            )}
          </div>
          <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
        </div>
      )}

      <p className="text-xs text-muted-foreground mb-1.5">
        {linked ? "Change linked property:" : "Link a property:"}
      </p>

      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => handleInput(e.target.value)}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            placeholder="Search by address…"
            className="w-full pl-8 pr-8 py-1.5 text-sm border border-border rounded-md outline-none focus:ring-2 ring-ring bg-background placeholder:text-muted-foreground/60"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        {open && results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-background shadow-md overflow-hidden">
            {results.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => link(r)}
                disabled={saving}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{r.address}{r.city ? `, ${r.city}` : ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {linked && (
        <button
          type="button"
          onClick={() => link(null)}
          disabled={saving}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
          Unlink property
        </button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
