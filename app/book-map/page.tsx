import { MapPinned } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { groupBookByCorridor, type BookPropertyPin } from "@/lib/book-corridors";
import { BookMapTabs } from "./book-map-tabs";

export const metadata = { title: "Book map – Beacon" };

export default async function BookMapPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; max?: string; type?: string }>;
}) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const sp = await searchParams;
  const minSqft = sp.min ? Number(sp.min) : null;
  const maxSqft = sp.max ? Number(sp.max) : null;
  const propertyType = sp.type?.trim() || null;

  const { data } = await supabase
    .from("properties")
    .select("id, address, city, submarket, size_sqft, property_type, latitude, longitude")
    .eq("owner_id", user.id)
    .order("address", { ascending: true })
    .limit(2000);

  const pins: BookPropertyPin[] = (data ?? []).map((p) => ({
    id: p.id,
    address: p.address,
    city: p.city,
    submarket: p.submarket,
    sizeSqft: p.size_sqft != null ? Number(p.size_sqft) : null,
    propertyType: p.property_type,
  }));

  const corridors = groupBookByCorridor(pins, {
    minSqft: minSqft != null && !Number.isNaN(minSqft) ? minSqft : null,
    maxSqft: maxSqft != null && !Number.isNaN(maxSqft) ? maxSqft : null,
    propertyType,
  });

  const types = [...new Set(pins.map((p) => p.propertyType).filter(Boolean) as string[])].sort();

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 max-w-[80rem] mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <MapPinned className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">Book map</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Corridor view and a pin map of geocoded properties. Missing pins can be geocoded from the toolbar.
        </p>
      </div>

      <BookMapTabs
        corridors={corridors}
        totalProperties={pins.length}
        types={types}
        initialMin={sp.min ?? ""}
        initialMax={sp.max ?? ""}
        initialType={propertyType ?? ""}
        pins={(data ?? [])
          .filter((p) => p.latitude != null && p.longitude != null)
          .map((p) => ({
            id: p.id,
            address: p.address,
            lat: Number(p.latitude),
            lng: Number(p.longitude),
          }))}
      />
    </div>
  );
}
