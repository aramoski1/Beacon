import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";
import { MAX_EXPORT_IDS } from "@/lib/crm-export";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  const ids = idsParam
    ? idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_EXPORT_IDS)
    : null;

  let leaseQuery = supabase
    .from("lease_abstracts")
    .select(
      "id, source_document, execution_date, expiration_date, term, base_rate, linked_property, custom_fields, created_at, properties(address, city)"
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  if (ids && ids.length > 0) {
    leaseQuery = leaseQuery.in("id", ids);
  }

  const [{ data: leases, error }, { data: fieldDefs }] = await Promise.all([
    leaseQuery,
    supabase
      .from("field_definitions")
      .select("*")
      .eq("owner_id", user.id)
      .eq("entity_type", "lease")
      .order("created_at", { ascending: true }),
  ]);

  if (error) return new Response("Failed to fetch leases", { status: 500 });

  const customDefs = (fieldDefs ?? []) as FieldDefinition[];

  const baseHeaders = [
    "id", "source_document", "execution_date", "expiration_date", "term", "base_rate",
    "property_address", "property_city", "linked_property", "created_at",
  ];
  const headers = [...baseHeaders, ...customDefs.map((d) => d.field_name)];

  const rows = (leases ?? []).map((l) => {
    const prop = (l as Record<string, unknown>).properties as { address: string | null; city: string | null } | null;
    const base = [
      l.id,
      l.source_document,
      l.execution_date,
      l.expiration_date,
      l.term,
      l.base_rate,
      prop?.address ?? null,
      prop?.city ?? null,
      l.linked_property,
      l.created_at,
    ];
    const custom = customDefs.map((d) => {
      const val = (l.custom_fields as Record<string, unknown> | null)?.[fieldSlug(d.field_name)];
      return val ?? null;
    });
    return [...base, ...custom];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leases");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as unknown as Uint8Array<ArrayBuffer>;

  const filename = ids?.length
    ? "beacon-leases-page.xlsx"
    : "beacon-leases.xlsx";

  return new Response(new Blob([buf]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
