import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="px-6 py-8 max-w-[100rem] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>

      {/* Kanban skeleton */}
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-56 shrink-0 space-y-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <div className="space-y-2">
              {Array.from({ length: i === 0 ? 3 : i === 1 ? 2 : 1 }).map((_, j) => (
                <div key={j} className="rounded-xl border bg-card p-3 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
