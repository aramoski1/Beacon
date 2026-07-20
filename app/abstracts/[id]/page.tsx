import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type FieldDefinition } from "@/lib/custom-fields";
import { LeaseReviewView } from "./review-view";
import type { FieldCitation, FieldReviews } from "./review-utils";

// ─── Local types ───────────────────────────────────────────────────────────────

type Escalation = { description: string; rate: string; effective_date?: string };
type LeaseOption = { type: "renewal" | "termination" | "expansion"; description: string; notice_period?: string };
type KeyProvision = { provision: string; citation?: string };

type TenantContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  company: string | null;
};

type LeaseAbstract = {
  id: string;
  source_document: string | null;
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  escalations: Escalation[];
  options: LeaseOption[];
  key_provisions: KeyProvision[];
  field_citations: FieldCitation[];
  field_reviews: FieldReviews;
  custom_fields: Record<string, string | number | null> | null;
  created_at: string;
  tenant_contact_id: string | null;
  linked_property: string | null;
};

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function AbstractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("lease_abstracts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) notFound();

  const abstract = data as LeaseAbstract;

  const [{ data: fdData }, { data: tenantContactData }, { data: propertyContactsData }, { data: linkedPropertyData }, pdfUrlResult] =
    await Promise.all([
      supabase
        .from("field_definitions")
        .select("*")
        .eq("entity_type", "lease")
        .order("created_at", { ascending: true }),
      abstract.tenant_contact_id
        ? supabase
            .from("contacts")
            .select("id, name, email, phone, role, company")
            .eq("id", abstract.tenant_contact_id)
            .eq("owner_id", user.id)
            .single()
            .then(r => ({ data: r.data as TenantContact | null }))
        : Promise.resolve({ data: null }),
      abstract.linked_property
        ? supabase
            .from("contacts")
            .select("id, name, role, company")
            .contains("linked_properties", [abstract.linked_property])
            .eq("owner_id", user.id)
            .order("name", { ascending: true })
        : Promise.resolve({ data: [] }),
      abstract.linked_property
        ? supabase
            .from("properties")
            .select("id, address, city")
            .eq("id", abstract.linked_property)
            .eq("owner_id", user.id)
            .single()
            .then(r => ({ data: r.data as { id: string; address: string; city: string | null } | null }))
        : Promise.resolve({ data: null }),
      // Signed URL for PDF viewer (1-hour expiry)
      abstract.source_document
        ? supabase.storage
            .from("leases")
            .createSignedUrl(abstract.source_document, 3600)
        : Promise.resolve({ data: null }),
    ]);

  const customDefs = (fdData ?? []) as FieldDefinition[];
  const tenantContact = tenantContactData as TenantContact | null;
  const propertyContacts = (propertyContactsData ?? []) as Pick<TenantContact, "id" | "name" | "role" | "company">[];
  const linkedProperty = linkedPropertyData as { id: string; address: string; city: string | null } | null;
  const pdfUrl = (pdfUrlResult as { data: { signedUrl: string } | null }).data?.signedUrl ?? null;

  return (
    <LeaseReviewView
      abstract={{ ...abstract, field_reviews: abstract.field_reviews ?? {} }}
      pdfUrl={pdfUrl}
      customDefs={customDefs}
      tenantContact={tenantContact}
      propertyContacts={propertyContacts}
      linkedProperty={linkedProperty}
    />
  );
}
