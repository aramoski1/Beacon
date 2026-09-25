"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { geocodeNominatim, geocodeStateFromProperty } from "@/lib/geocode";
import { enqueueJob } from "@/lib/jobs";

export async function geocodeMissingProperties(limit = 25): Promise<{
  geocoded: number;
  failed: number;
  remaining: number;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { geocoded: 0, failed: 0, remaining: 0 };

  const { data: rows } = await supabase
    .from("properties")
    .select("id, address, city, geographic_category, source_url")
    .eq("owner_id", user.id)
    .is("latitude", null)
    .not("address", "is", null)
    .limit(limit);

  let geocoded = 0;
  let failed = 0;
  for (const p of rows ?? []) {
    if (!p.address) continue;
    const state = geocodeStateFromProperty({
      geographic_category: p.geographic_category,
      source_url: p.source_url,
      city: p.city,
    });
    const result = await geocodeNominatim(p.address, p.city, state);
    if ("error" in result) {
      failed += 1;
      continue;
    }
    await supabase
      .from("properties")
      .update({
        latitude: result.lat,
        longitude: result.lng,
        geocoded_at: new Date().toISOString(),
      })
      .eq("id", p.id)
      .eq("owner_id", user.id);
    geocoded += 1;
    await new Promise((r) => setTimeout(r, 1100));
  }

  const { count } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .is("latitude", null)
    .not("address", "is", null);

  revalidatePath("/book-map");
  return { geocoded, failed, remaining: count ?? 0 };
}

export async function enqueueGeocodeJob(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  return enqueueJob(supabase as never, user.id, "geocode_property", {});
}
