"use client";

import { useState, useEffect } from "react";
import { Loader2, Building2, Search, X } from "lucide-react";
import { getAllPropertiesForPicker } from "@/app/abstracts/new/actions";

export type PropertyOption = { id: string; address: string; city: string | null };

/** Type-to-search property picker. Selected state renders as a chip with a clear button. */
export function PropertyPicker({
  value,
  label,
  onChange,
  initialSearch,
}: {
  value: string | null;
  label: string | null;
  onChange: (id: string | null, label: string | null) => void;
  initialSearch?: string | null;
}) {
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getAllPropertiesForPicker().then((props) => {
      setAllProperties(props);
      setLoading(false);
      // Auto-select when the caller's hint address matches a property
      if (initialSearch && !value) {
        const q = initialSearch.toLowerCase();
        const match = props.find((p) => p.address.toLowerCase().includes(q));
        if (match) {
          onChange(match.id, match.address + (match.city ? `, ${match.city}` : ""));
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = query.trim()
    ? allProperties.filter((p) =>
        (p.address + (p.city ? ` ${p.city}` : "")).toLowerCase().includes(query.toLowerCase())
      )
    : allProperties;

  if (value && label) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
        <Building2 className="size-4 text-primary shrink-0" />
        <span className="text-sm font-medium flex-1 min-w-0 truncate">{label}</span>
        <button
          type="button"
          onClick={() => onChange(null, null)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title="Clear"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={loading ? "Loading properties…" : `Search ${allProperties.length} properties…`}
          disabled={loading}
          className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md outline-none focus:ring-2 ring-ring bg-background placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && !loading && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-y-auto max-h-56">
          {filtered.length > 0 ? filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(r.id, r.address + (r.city ? `, ${r.city}` : ""));
                setQuery("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2"
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
  );
}
