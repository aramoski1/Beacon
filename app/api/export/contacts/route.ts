import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [{ data: contacts, error }, { data: fieldDefs }] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, name, company, role, email, phone, contact_tier, client_status, size_category, geographic_category, ownership_type, action_tags, last_contacted_at, created_at, custom_fields"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("field_definitions")
      .select("*")
      .eq("owner_id", user.id)
      .eq("entity_type", "contact")
      .order("created_at", { ascending: true }),
  ]);

  if (error) return new Response("Failed to fetch contacts", { status: 500 });

  const customDefs = (fieldDefs ?? []) as FieldDefinition[];

  const baseHeaders = [
    "id", "name", "company", "role", "email", "phone",
    "contact_tier", "client_status", "size_category", "geographic_category",
    "ownership_type", "action_tags", "last_contacted_at", "created_at",
  ];
  const headers = [...baseHeaders, ...customDefs.map((d) => d.field_name)];

  const rows = (contacts ?? []).map((c) => {
    const base = [
      c.id, c.name, c.company, c.role, c.email, c.phone,
      c.contact_tier, c.client_status, c.size_category, c.geographic_category,
      c.ownership_type, (c.action_tags ?? []).join("|"), c.last_contacted_at, c.created_at,
    ];
    const custom = customDefs.map((d) => {
      const val = (c.custom_fields as Record<string, unknown> | null)?.[fieldSlug(d.field_name)];
      return val ?? null;
    });
    return [...base, ...custom];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as unknown as Uint8Array<ArrayBuffer>;

  return new Response(new Blob([buf]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="beacon-contacts.xlsx"',
    },
  });
}
