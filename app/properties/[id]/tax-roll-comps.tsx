import { MapPinned, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTaxRollCompsForProperty } from "./comps-actions";
import { pricePerAcre, type TaxRollComp } from "@/lib/mdpa-comps";

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y}`;
}

const GRID_COLS = "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto_auto]";

function CompRow({ c }: { c: TaxRollComp }) {
  const perAcre = pricePerAcre(c.salePrice, c.landSqft);
  return (
    <li className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-border/60 py-2.5 last:border-0 ${GRID_COLS}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {c.address ?? c.strap}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {c.strap}
          {c.city ? ` · ${c.city}` : ""}
          {c.dorCode ? ` · DOR ${c.dorCode}` : c.dorDescription ? ` · ${c.dorDescription}` : ""}
        </p>
      </div>
      <div className="hidden text-sm tabular-nums text-muted-foreground sm:block">
        {c.sizeSqft != null ? `${c.sizeSqft.toLocaleString()} sf` : "—"}
      </div>
      <div className="hidden text-sm tabular-nums text-muted-foreground sm:block" title={perAcre != null ? "Sale price ÷ land size in acres" : undefined}>
        {perAcre != null ? `${fmtMoney(perAcre)}/ac` : "—"}
      </div>
      <div className="text-right text-sm tabular-nums">{fmtDate(c.saleDate)}</div>
      <div className="text-right text-sm font-medium tabular-nums">
        {c.salePrice != null ? fmtMoney(c.salePrice) : "—"}
      </div>
      {(c.sameDor || c.sameDorClass) && (
        <div className="col-span-full sm:col-span-5">
          <Badge variant="secondary" className="text-[10px] font-normal">
            {c.sameDor ? "Same DOR" : "Same use class"}
          </Badge>
        </div>
      )}
    </li>
  );
}

export async function TaxRollCompsSection({
  sourceUrl,
  address,
}: {
  sourceUrl: string | null;
  address: string | null;
}) {
  const result = await getTaxRollCompsForProperty({ sourceUrl, address });

  if ("error" in result) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <MapPinned className="size-4" />
            Tax-roll comps
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
          <MapPinned className="size-4" />
          Tax-roll comps
        </CardTitle>
        <p className="text-xs text-muted-foreground">{result.note}</p>
      </CardHeader>
      <CardContent>
        {result.comps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comps to show.</p>
        ) : (
          <ul className="divide-y-0">
            <li className={`mb-1 hidden gap-x-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:grid ${GRID_COLS}`}>
              <span>Parcel</span>
              <span>Building SF</span>
              <span>Price/acre</span>
              <span className="text-right">Sale date</span>
              <span className="text-right">Sale price</span>
            </li>
            {result.comps.map((c) => (
              <CompRow key={c.folio} c={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
