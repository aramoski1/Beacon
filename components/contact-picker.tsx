"use client";

import { useState, useEffect } from "react";
import { Loader2, User, Search, X } from "lucide-react";
import { getAllContactsForPicker } from "@/app/contacts/new/actions";

export type ContactOption = { id: string; name: string | null; company: string | null };

/** Type-to-search contact picker. Selected state renders as a chip with a clear button. */
export function ContactPicker({
  value,
  label,
  onChange,
}: {
  value: string | null;
  label: string | null;
  onChange: (id: string | null, label: string | null) => void;
}) {
  const [allContacts, setAllContacts] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getAllContactsForPicker().then((contacts) => {
      setAllContacts(contacts);
      setLoading(false);
    });
  }, []);

  const filtered = query.trim()
    ? allContacts.filter((c) =>
        ((c.name ?? "") + (c.company ? ` ${c.company}` : "")).toLowerCase().includes(query.toLowerCase())
      )
    : allContacts;

  if (value && label) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
        <User className="size-4 text-primary shrink-0" />
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
          placeholder={loading ? "Loading contacts…" : `Search ${allContacts.length} contacts…`}
          disabled={loading}
          className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md outline-none focus:ring-2 ring-ring bg-background placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && !loading && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-y-auto max-h-56">
          {filtered.length > 0 ? filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c.id, (c.name ?? "Unnamed") + (c.company ? ` — ${c.company}` : ""));
                setQuery("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2"
            >
              <User className="size-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{c.name ?? "Unnamed"}{c.company ? ` — ${c.company}` : ""}</span>
            </button>
          )) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No contacts match &ldquo;{query}&rdquo;
            </p>
          )}
        </div>
      )}
    </div>
  );
}
