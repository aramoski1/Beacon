"use client";

import { useState, useTransition } from "react";
import { DollarSign, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRentBand, type RentBand } from "@/lib/submarket-rent-bands";
import { addRentComp, deleteRentComp, type RentCompRow } from "./rent-notebook-actions";

export function RentNotebook({
  propertyId,
  submarket,
  band,
  initialComps,
}: {
  propertyId: string;
  submarket: string | null;
  band: RentBand | null;
  initialComps: RentCompRow[];
}) {
  const [comps, setComps] = useState(initialComps);
  const [address, setAddress] = useState("");
  const [rent, setRent] = useState("");
  const [sf, setSf] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  function add() {
    const rentPsf = rent.trim() ? Number(rent) : null;
    start(async () => {
      const res = await addRentComp({
        propertyId,
        address: address.trim() || null,
        submarket,
        rentPsf: rentPsf != null && !Number.isNaN(rentPsf) ? rentPsf : null,
        sizeSqft: sf.trim() ? Number(sf) : null,
        notes: notes.trim() || null,
      });
      if (res.error) {
        window.alert(res.error);
        return;
      }
      setComps((prev) => [
        {
          id: res.id!,
          address: address.trim() || null,
          submarket,
          property_type: "industrial",
          size_sqft: sf.trim() ? Number(sf) : null,
          rent_psf: rentPsf,
          lease_structure: "nnn",
          comp_date: new Date().toISOString().slice(0, 10),
          notes: notes.trim() || null,
          source: "manual",
        },
        ...prev,
      ]);
      setAddress("");
      setRent("");
      setSf("");
      setNotes("");
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <DollarSign className="size-4" />
          Rent notebook
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Seed bands for South Florida industrial (not CoStar). Add your own comps for BOVs.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {band ? (
          <p className="text-sm">
            <Badge variant="secondary" className="mr-2">{band.submarket}</Badge>
            Indicative {formatRentBand(band)} — {band.notes}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No seed band for this submarket. Add comps below or set submarket on the property.
          </p>
        )}

        <ul className="divide-y rounded-lg border">
          {comps.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No comps logged yet.</li>
          )}
          {comps.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{c.address ?? "Comp"}</p>
                <p className="text-xs text-muted-foreground">
                  {c.rent_psf != null ? `$${c.rent_psf}/SF` : "—"}
                  {c.size_sqft != null ? ` · ${c.size_sqft.toLocaleString()} SF` : ""}
                  {c.comp_date ? ` · ${c.comp_date}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  start(async () => {
                    const res = await deleteRentComp(c.id);
                    if (!res.error) setComps((prev) => prev.filter((x) => x.id !== c.id));
                  });
                }}
                aria-label="Delete comp"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="col-span-2 text-sm border rounded-md px-2 py-1.5 bg-background"
          />
          <input
            placeholder="$/SF"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          />
          <input
            placeholder="SF"
            value={sf}
            onChange={(e) => setSf(e.target.value)}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          />
          <input
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="col-span-2 sm:col-span-3 text-sm border rounded-md px-2 py-1.5 bg-background"
          />
          <button
            type="button"
            disabled={pending}
            onClick={add}
            className="text-xs font-medium rounded-md bg-primary text-primary-foreground px-3 py-1.5 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin mx-auto" /> : "Add comp"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
