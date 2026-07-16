import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-md bg-muted animate-pulse", className)} />
  );
}

export function PortfolioSkeleton() {
  return (
    <div className="space-y-8 py-4">
      {/* Header */}
      <div className="space-y-2">
        <Bone className="h-3 w-24" />
        <Bone className="h-6 w-48" />
        <Bone className="h-4 w-32" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card px-4 py-3 space-y-2">
            <Bone className="h-3 w-16" />
            <Bone className="h-7 w-12" />
          </div>
        ))}
      </div>

      {/* AI section placeholder */}
      <div className="rounded-xl border bg-card px-4 py-8">
        <div className="flex flex-col items-center gap-2">
          <Bone className="h-4 w-48" />
          <Bone className="h-3 w-64" />
          <Bone className="h-9 w-36 mt-2" />
        </div>
      </div>

      {/* Properties list */}
      <div className="rounded-xl border bg-card overflow-hidden divide-y">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Bone className="size-9 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-4 w-48" />
              <Bone className="h-3 w-32" />
            </div>
            <Bone className="h-3 w-14 shrink-0" />
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="rounded-xl border bg-card overflow-hidden divide-y">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Bone className="h-5 w-16 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-4 w-40" />
              <Bone className="h-3 w-24" />
            </div>
            <Bone className="h-3 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
