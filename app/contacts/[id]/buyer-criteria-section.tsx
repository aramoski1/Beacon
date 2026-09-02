"use client";

import { useState } from "react";
import { Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export type BuyerCriteriaValues = {
  cap_rate_target: number | null;
  preferred_markets: string[];
  preferred_min_sf: number | null;
  preferred_max_sf: number | null;
  exchange_1031_deadline: string | null;
  buyer_criteria_notes: string | null;
};

export function BuyerCriteriaSection({
  contactId,
  initial,
}: {
  contactId: string;
  initial: BuyerCriteriaValues;
}) {
  const [values, setValues] = useState(initial);
  const [marketDraft, setMarketDraft] = useState("");

  async function save<K extends keyof BuyerCriteriaValues>(field: K, value: BuyerCriteriaValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", contactId);
    if (error) {
      window.alert(`Failed to save: ${error.message}`);
      setValues((prev) => ({ ...prev, [field]: initial[field] }));
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="size-4" />
          Buyer / 1031 criteria
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Cap rate target %</dt>
            <dd>
              <input
                type="number"
                step="0.1"
                value={values.cap_rate_target ?? ""}
                onChange={(e) => save("cap_rate_target", e.target.value === "" ? null : Number(e.target.value))}
                className="mt-0.5 w-full text-sm border rounded-md px-2 py-1 bg-background"
                placeholder="e.g. 6.5"
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Min SF</dt>
            <dd>
              <input
                type="number"
                value={values.preferred_min_sf ?? ""}
                onChange={(e) => save("preferred_min_sf", e.target.value === "" ? null : Number(e.target.value))}
                className="mt-0.5 w-full text-sm border rounded-md px-2 py-1 bg-background"
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Max SF</dt>
            <dd>
              <input
                type="number"
                value={values.preferred_max_sf ?? ""}
                onChange={(e) => save("preferred_max_sf", e.target.value === "" ? null : Number(e.target.value))}
                className="mt-0.5 w-full text-sm border rounded-md px-2 py-1 bg-background"
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">1031 deadline</dt>
            <dd>
              <input
                type="date"
                value={values.exchange_1031_deadline ?? ""}
                onChange={(e) => save("exchange_1031_deadline", e.target.value || null)}
                className="mt-0.5 w-full text-sm border rounded-md px-2 py-1 bg-background"
              />
            </dd>
          </div>
        </dl>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Preferred markets</p>
          <div className="flex flex-wrap gap-1 mb-1">
            {values.preferred_markets.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => save("preferred_markets", values.preferred_markets.filter((x) => x !== m))}
                className="text-[11px] rounded-full bg-muted px-2 py-0.5 hover:bg-destructive/10"
              >
                {m} ×
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = marketDraft.trim();
              if (t && !values.preferred_markets.includes(t)) {
                save("preferred_markets", [...values.preferred_markets, t]);
              }
              setMarketDraft("");
            }}
            className="flex gap-2"
          >
            <input
              value={marketDraft}
              onChange={(e) => setMarketDraft(e.target.value)}
              placeholder="Add market"
              className="text-sm border rounded-md px-2 py-1 bg-background flex-1"
            />
            <button type="submit" className="text-xs font-medium border rounded-md px-2">Add</button>
          </form>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <textarea
            value={values.buyer_criteria_notes ?? ""}
            onChange={(e) => save("buyer_criteria_notes", e.target.value || null)}
            rows={2}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background"
          />
        </div>
      </CardContent>
    </Card>
  );
}
