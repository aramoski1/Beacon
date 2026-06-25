import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      aria-hidden
    />
  );
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden" aria-busy aria-label="Loading">
      <div className="border-b bg-muted/30 px-4 py-3 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1 max-w-[8rem]" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-4 py-3.5 flex gap-4 items-center">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 flex-1 max-w-[12rem]" />
            <Skeleton className="h-4 w-16 hidden sm:block" />
            <Skeleton className="h-5 w-14 rounded-full hidden md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
