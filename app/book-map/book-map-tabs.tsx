"use client";

import { useState } from "react";
import { BookCorridorsView } from "./book-corridors-view";
import { BookPinMap, type MapPin } from "./pin-map";
import { GeocodeBookButton } from "./geocode-button";
import type { CorridorBucket } from "@/lib/book-corridors";

export function BookMapTabs({
  corridors,
  totalProperties,
  types,
  initialMin,
  initialMax,
  initialType,
  pins,
}: {
  corridors: CorridorBucket[];
  totalProperties: number;
  types: string[];
  initialMin: string;
  initialMax: string;
  initialType: string;
  pins: MapPin[];
}) {
  const [tab, setTab] = useState<"corridors" | "map">("map");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border p-0.5">
          <button
            type="button"
            onClick={() => setTab("map")}
            className={`px-3 py-1 text-xs font-medium rounded-md ${tab === "map" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Pin map
          </button>
          <button
            type="button"
            onClick={() => setTab("corridors")}
            className={`px-3 py-1 text-xs font-medium rounded-md ${tab === "corridors" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Corridors
          </button>
        </div>
        {tab === "map" && <GeocodeBookButton />}
      </div>
      {tab === "map" ? (
        <BookPinMap pins={pins} />
      ) : (
        <BookCorridorsView
          corridors={corridors}
          totalProperties={totalProperties}
          types={types}
          initialMin={initialMin}
          initialMax={initialMax}
          initialType={initialType}
        />
      )}
    </div>
  );
}
