"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { interpretSearch } from "@/app/crm/actions";

const EXAMPLES = [
  "Industrial owners over 100k sqft",
  "Tier 1 contacts not contacted in 30 days",
  "Leases expiring within 90 days",
];

export function DashboardSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await interpretSearch(trimmed);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      sessionStorage.setItem("beacon_crm_search", JSON.stringify({ query: trimmed, result }));
      router.push("/crm");
    });
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
        className="relative"
      >
        {pending ? (
          <Loader2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin" />
        ) : (
          <Sparkles className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask your book anything…"
          disabled={pending}
          className="w-full rounded-lg border border-border bg-background pl-9 pr-24 py-2.5 text-sm outline-none focus:ring-2 ring-ring placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <Search className="size-3.5" />
          Search
        </button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => { setQuery(ex); runSearch(ex); }}
            disabled={pending}
            className={cn(
              "rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground",
              "hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
            )}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
