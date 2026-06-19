import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [{ data: leases, error }, { data: fieldDefs }] = await Promise.all([
    supabase
      .from("lease_abstracts")
      .select(
        "id, source_document, tenant_name, landlord_name, property_address, execution_date, expiration_date, term, base_rate, rent_escalation, security_deposit, custom_fields, created_at"
      )
      .order("created_at", { ascending: false }),
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
    "id", "source_document", "tenant_name", "landlord_name", "property_address",
    "execution_date", "expiration_date", "term", "base_rate",
    "rent_escalation", "security_deposit", "created_at",
  ];
  const headers = [...baseHeaders, ...customDefs.map((d) => d.field_name)];

  const rows = (leases ?? []).map((l) => {
    const base = [
      l.id,
      l.source_document,
      (l as Record<string, unknown>).tenant_name ?? null,
      (l as Record<string, unknown>).landlord_name ?? null,
      (l as Record<string, unknown>).property_address ?? null,
      l.execution_date,
      l.expiration_date,
      l.term,
      l.base_rate,
      (l as Record<string, unknown>).rent_escalation ?? null,
      (l as Record<string, unknown>).security_deposit ?? null,
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

  return new Response(new Blob([buf]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="beacon-leases.xlsx"',
    },
  });
}
