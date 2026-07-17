import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [{ data: properties, error }, { data: fieldDefs }] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id, address, city, submarket, owner_name, ownership_type, property_type, size_sqft, size_category, geographic_category, last_sale_date, last_sale_price, source, ingested_at, custom_fields"
      )
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("field_definitions")
      .select("*")
      .eq("owner_id", user.id)
      .eq("entity_type", "property")
      .order("created_at", { ascending: true }),
  ]);

  if (error) return new Response("Failed to fetch properties", { status: 500 });

  const customDefs = (fieldDefs ?? []) as FieldDefinition[];

  const baseHeaders = [
    "id", "address", "city", "submarket", "owner_name", "ownership_type",
    "property_type", "size_sqft", "size_category", "geographic_category",
    "last_sale_date", "last_sale_price", "source", "ingested_at",
  ];
  const headers = [...baseHeaders, ...customDefs.map((d) => d.field_name)];

  const rows = (properties ?? []).map((p) => {
    const base = [
      p.id, p.address, p.city, p.submarket, p.owner_name, p.ownership_type,
      p.property_type, p.size_sqft, p.size_category, p.geographic_category,
      p.last_sale_date, p.last_sale_price, p.source, p.ingested_at,
    ];
    const custom = customDefs.map((d) => {
      const val = (p.custom_fields as Record<string, unknown> | null)?.[fieldSlug(d.field_name)];
      return val ?? null;
    });
    return [...base, ...custom];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Properties");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as unknown as Uint8Array<ArrayBuffer>;

  return new Response(new Blob([buf]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="beacon-properties.xlsx"',
    },
  });
}
