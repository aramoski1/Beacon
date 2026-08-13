"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PropertyPicker } from "@/components/property-picker";
import { linkContactsToProperty } from "@/app/crm/actions";

export type LinkedPropertyItem = {
  id: string;
  address: string | null;
  city: string | null;
  property_type: string | null;
  size_sqft: number | null;
};

export function LinkPropertySection({
  contactId,
  linkedProperties,
}: {
  contactId: string;
  linkedProperties: LinkedPropertyItem[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [propId, setPropId] = useState<string | null>(null);
  const [propLabel, setPropLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setAdding(false);
    setPropId(null);
    setPropLabel(null);
    setError(null);
  }

  async function handleLink() {
    if (!propId) return;
    setBusy(true);
    setError(null);
    const res = await linkContactsToProperty(propId, [contactId]);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    cancel();
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end mb-2">
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="size-3.5" /> Link property
          </button>
        )}
      </div>

      {adding && (
        <div className="space-y-2 rounded-lg border p-3 bg-muted/10 mb-3">
          <PropertyPicker
            value={propId}
            label={propLabel}
            onChange={(id, label) => { setPropId(id); setPropLabel(label); }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!propId || busy} onClick={handleLink}>
              {busy ? <><Loader2 className="size-3.5 animate-spin" />Linking…</> : "Link"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {linkedProperties.length === 0 ? (
        <p className="text-sm text-muted-foreground">No linked properties.</p>
      ) : (
        <div className="space-y-2">
          {linkedProperties.map((p) => (
            <Link
              key={p.id}
              href={`/properties/${p.id}`}
              className="block rounded-lg border bg-muted/20 px-3 py-2 hover:bg-muted/50 transition-colors"
            >
              <p className="font-medium text-sm truncate">{p.address ?? "Unknown address"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {[
                  p.city,
                  p.property_type,
                  p.size_sqft != null ? `${p.size_sqft.toLocaleString()} sf` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
