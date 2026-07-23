"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, Building2, Search, CheckCircle2 } from "lucide-react";
import { setLeaseProperty } from "./actions";
import { getAllPropertiesForPicker } from "../new/actions";

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
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllPropertiesForPicker().then((props) => {
      setAllProperties(props);
      setLoadingList(false);
    });
  }, []);

  const filtered = query.trim()
    ? allProperties.filter((p) =>
        (p.address + (p.city ? ` ${p.city}` : "")).toLowerCase().includes(query.toLowerCase())
      )
    : allProperties;

  async function link(prop: PropertyOption) {
    setError(null);
    setSaving(true);
    const res = await setLeaseProperty(leaseId, prop.id);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setLinked(prop);
    setQuery("");
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
        {linked
          ? "Relink to a different property (clearing is blocked — Lease radar needs a property):"
          : "Link a property — required for Lease radar and follow-ups:"}
      </p>

      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={
              loadingList
                ? "Loading properties…"
                : `Search ${allProperties.length} properties…`
            }
            disabled={loadingList || saving}
            className="w-full pl-8 pr-8 py-1.5 text-sm border border-border rounded-md outline-none focus:ring-2 ring-ring bg-background placeholder:text-muted-foreground/60 disabled:opacity-60"
          />
          {(loadingList || saving) && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        {open && !loadingList && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-background shadow-md overflow-y-auto max-h-52">
            {filtered.length > 0 ? filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => link(r)}
                disabled={saving}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{r.address}{r.city ? `, ${r.city}` : ""}</span>
              </button>
            )) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No properties match &ldquo;{query}&rdquo;
              </p>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
