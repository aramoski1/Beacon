"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { osmSearchUrl, type CorridorBucket } from "@/lib/book-corridors";

export function BookCorridorsView({
  corridors,
  totalProperties,
  types,
  initialMin,
  initialMax,
  initialType,
}: {
  corridors: CorridorBucket[];
  totalProperties: number;
  types: string[];
  initialMin: string;
  initialMax: string;
  initialType: string;
}) {
  const router = useRouter();
  const maxCount = Math.max(...corridors.map((c) => c.count), 1);

  function applyFilters(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const min = (fd.get("min") as string)?.trim();
    const max = (fd.get("max") as string)?.trim();
    const type = (fd.get("type") as string)?.trim();
    if (min) params.set("min", min);
    if (max) params.set("max", max);
    if (type) params.set("type", type);
    const q = params.toString();
    router.push(q ? `/book-map?${q}` : "/book-map");
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={applyFilters}
        className="flex flex-wrap gap-2 items-end rounded-xl border bg-card p-4"
      >
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase">Min SF</label>
          <input
            name="min"
            type="number"
            defaultValue={initialMin}
            placeholder="e.g. 20000"
            className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase">Max SF</label>
          <input
            name="max"
            type="number"
            defaultValue={initialMax}
            placeholder="e.g. 100000"
            className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase">Type</label>
          <select
            name="type"
            defaultValue={initialType}
            className="rounded-md border bg-background px-2 py-1.5 text-sm min-w-[8rem]"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium"
        >
          Apply
        </button>
        <p className="text-xs text-muted-foreground self-center ml-auto">
          {corridors.reduce((n, c) => n + c.count, 0)} shown · {totalProperties} in book
        </p>
      </form>

      {corridors.length === 0 ? (
        <div className="rounded-xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No properties in this filter. Add addresses in Workspace or clear filters.
        </div>
      ) : (
        <div className="space-y-4">
          {corridors.map((c) => (
            <section key={c.key} className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap">
                <h2 className="text-sm font-semibold">{c.label}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {c.count} · {c.totalSqft.toLocaleString()} SF
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-muted max-w-[12rem]">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.round((c.count / maxCount) * 100)}%` }}
                  />
                </div>
              </div>
              <ul className="divide-y max-h-64 overflow-y-auto">
                {c.properties.map((p) => {
                  const mapHref = osmSearchUrl(p.address, p.city);
                  return (
                    <li key={p.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <Link
                        href={`/properties/${p.id}`}
                        className="flex-1 min-w-0 truncate font-medium hover:text-primary"
                      >
                        {p.address ?? "No address"}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {p.sizeSqft != null ? `${p.sizeSqft.toLocaleString()} SF` : "—"}
                      </span>
                      {mapHref && (
                        <a
                          href={mapHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline underline-offset-2 shrink-0"
                        >
                          Map <ExternalLink className="size-2.5" />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
