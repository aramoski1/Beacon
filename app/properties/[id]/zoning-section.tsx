"use client";

import { useState } from "react";
import { AlertTriangle, Landmark, Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPropertyZoning, type ZoningResult } from "./actions";
import type { ZoningInfo } from "@/lib/zoning";

type ZoningPhase =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "result"; result: ZoningResult };

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
      <Loader2 className="size-4 animate-spin shrink-0" />
      {label}
    </div>
  );
}

function ErrorBox({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <p>{message}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onBack}>Try again</Button>
    </div>
  );
}

export function ZoningSection({
  propertyId,
  needsCountyEnhancement,
  initialZoning,
}: {
  propertyId: string;
  /** Zoning runs automatically once county enrichment has run (see
   * app/properties/[id]/actions.ts's applyCountyEnhancement and
   * app/properties/new/actions.ts's saveIngestedProperty) — this only
   * affects the "not checked yet" copy shown while idle. */
  needsCountyEnhancement: boolean;
  /** Persisted result of the last zoning lookup (lib/zoning-persist.ts).
   * Null means zoning hasn't been checked yet (e.g. a property enriched
   * before this feature existed) — falls back to a manual "Look up". */
  initialZoning: { zone: ZoningInfo; source: string; geocoded: boolean } | null;
}) {
  const [zoning, setZoning] = useState<ZoningPhase>(
    initialZoning
      ? { tag: "result", result: { kind: "ok", zone: initialZoning.zone, source: initialZoning.source, geocoded: initialZoning.geocoded } }
      : { tag: "idle" }
  );

  function handleLookup() {
    setZoning({ tag: "loading" });
    getPropertyZoning(propertyId).then((res) => {
      if ("error" in res) { setZoning({ tag: "error", message: res.error }); return; }
      setZoning({ tag: "result", result: res.result });
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="size-4" />
          Zoning
        </CardTitle>
      </CardHeader>
      <CardContent>
        {zoning.tag === "idle" && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {needsCountyEnhancement
                ? "Zoning runs automatically once you enrich this property from county records below."
                : "Not checked yet — this property was enriched before zoning lookup existed. Check now:"}
            </p>
            <Button size="sm" variant="outline" onClick={handleLookup} className="shrink-0 flex items-center gap-1.5">
              <Search className="size-3.5" /> Look up
            </Button>
          </div>
        )}

        {zoning.tag === "loading" && <Spinner label="Looking up zoning…" />}

        {zoning.tag === "error" && (
          <ErrorBox message={zoning.message} onBack={() => setZoning({ tag: "idle" })} />
        )}

        {zoning.tag === "result" && zoning.result.kind === "unavailable" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 text-yellow-500 shrink-0 mt-0.5" />
              {zoning.result.reason}
            </p>
            <button
              onClick={() => setZoning({ tag: "idle" })}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Back
            </button>
          </div>
        )}

        {zoning.tag === "result" && zoning.result.kind === "error" && (
          <ErrorBox message={zoning.result.message} onBack={() => setZoning({ tag: "idle" })} />
        )}

        {zoning.tag === "result" && zoning.result.kind === "ok" && (() => {
          const { zone, source, geocoded } = zoning.result;
          const metrics = (
            [
              ["FAR", zone.farEffective != null ? String(zone.farEffective) : null],
              ["Max height", zone.maxHeightFt != null ? `${zone.maxHeightFt} ft` : null],
              ["Max dwelling units", zone.maxDwellingUnits != null ? String(zone.maxDwellingUnits) : null],
              ["Density", zone.dwellingUnitsPerAcre != null ? `${zone.dwellingUnitsPerAcre} du/acre` : null],
              ["Min lot size", zone.minLotSizeSqft != null ? `${zone.minLotSizeSqft.toLocaleString()} sqft` : null],
            ] as [string, string | null][]
          ).filter((pair): pair is [string, string] => pair[1] != null);

          return (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-sm font-semibold">
                  {zone.code ?? "—"}
                </span>
                {zone.name && <span className="text-sm font-medium">{zone.name}</span>}
              </div>
              {zone.municipality && <p className="text-xs text-muted-foreground">{zone.municipality}</p>}
              {zone.useDescription && <p className="text-sm">{zone.useDescription}</p>}
              {zone.overlay && (
                <p className="text-xs text-muted-foreground">Overlay: <span className="font-medium">{zone.overlay}</span></p>
              )}
              {metrics.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {metrics.map(([label, value]) => (
                    <div key={label} className="rounded-lg border bg-muted/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-sm font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Source: {source}</p>
              {geocoded && (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="size-3.5 text-yellow-500 shrink-0 mt-0.5" />
                  Located by geocoding the address, not an exact parcel match — double-check this
                  against the county/MAPC zoning map if the property sits near a district boundary
                  or on a street name that repeats elsewhere in the same city.
                </p>
              )}
              <button
                onClick={handleLookup}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Re-check
              </button>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
