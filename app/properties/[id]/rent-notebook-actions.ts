"use server";

import { createClient } from "@/lib/supabase/server";
import { withAction } from "@/lib/logger";
import { lookupRentBand } from "@/lib/submarket-rent-bands";

export type RentCompRow = {
  id: string;
  address: string | null;
  submarket: string | null;
  property_type: string | null;
  size_sqft: number | null;
  rent_psf: number | null;
  lease_structure: string | null;
  comp_date: string | null;
  notes: string | null;
  source: string;
};

export async function listRentComps(propertyId: string): Promise<RentCompRow[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("rent_comps")
    .select("id, address, submarket, property_type, size_sqft, rent_psf, lease_structure, comp_date, notes, source")
    .eq("owner_id", user.id)
    .eq("property_id", propertyId)
    .order("comp_date", { ascending: false, nullsFirst: false })
    .limit(40);
  return (data ?? []) as RentCompRow[];
}

export async function addRentComp(input: {
  propertyId: string;
  address: string | null;
  submarket: string | null;
  rentPsf: number | null;
  sizeSqft: number | null;
  notes: string | null;
}): Promise<{ error?: string; id?: string }> {
  return withAction("addRentComp", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated." };
    const { data, error } = await supabase
      .from("rent_comps")
      .insert({
        owner_id: user.id,
        property_id: input.propertyId,
        address: input.address,
        submarket: input.submarket,
        rent_psf: input.rentPsf,
        size_sqft: input.sizeSqft,
        notes: input.notes,
        source: "manual",
        comp_date: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    return { id: data.id };
  });
}

export async function deleteRentComp(id: string): Promise<{ error?: string }> {
  return withAction("deleteRentComp", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated." };
    const { error } = await supabase.from("rent_comps").delete().eq("id", id).eq("owner_id", user.id);
    if (error) return { error: error.message };
    return {};
  });
}

export async function rentBandForSubmarket(submarket: string | null) {
  return lookupRentBand(submarket);
}
