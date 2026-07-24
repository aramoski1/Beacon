import { FileText, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLeaseCompsForProperty } from "./lease-comps-actions";
import type { LeaseComp } from "@/lib/lease-comps";

function fmtRate(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}/SF`;
}

function CompRow({ c }: { c: LeaseComp }) {
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-border/60 py-2.5 last:border-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_auto_auto]">
      <div className="min-w-0">
        <Link
          href={`/properties/${c.propertyId}`}
          className="truncate text-sm font-medium text-foreground hover:underline underline-offset-2 block"
        >
          {c.address ?? "Property"}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {[c.submarket, c.propertyType].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <div className="hidden text-sm tabular-nums text-muted-foreground sm:block">
        {c.sizeSqft != null ? `${c.sizeSqft.toLocaleString()} sf` : "—"}
      </div>
      <div className="text-right text-sm text-muted-foreground truncate max-w-[7rem]">
        {c.term ?? "—"}
      </div>
      <div className="text-right text-sm font-medium tabular-nums">
        {c.baseRate != null ? fmtRate(c.baseRate) : "—"}
      </div>
      {(c.sameSubmarket || c.sameType || c.withinSfBand) && (
        <div className="col-span-full sm:col-span-4 flex flex-wrap gap-1">
          {c.sameSubmarket && (
            <Badge variant="secondary" className="text-[10px] font-normal">Same submarket</Badge>
          )}
          {c.sameType && (
            <Badge variant="secondary" className="text-[10px] font-normal">Same type</Badge>
          )}
          {c.withinSfBand && (
            <Badge variant="secondary" className="text-[10px] font-normal">Similar SF</Badge>
          )}
        </div>
      )}
    </li>
  );
}

export async function LeaseCompsSection({ propertyId }: { propertyId: string }) {
  const result = await getLeaseCompsForProperty(propertyId);

  if ("error" in result) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <FileText className="size-4" />
            Lease comps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {result.error}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <FileText className="size-4" />
          Lease comps
        </CardTitle>
        <p className="text-xs text-muted-foreground">{result.note}</p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y-0">
          {result.comps.map((c) => (
            <CompRow key={c.leaseId} c={c} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
