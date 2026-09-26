import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { isSoloFirmForUser } from "@/lib/firms";
import { type FieldDefinition } from "@/lib/custom-fields";
import { LeaseReviewView } from "./review-view";
import type { FieldCitation, FieldReviews } from "./review-utils";
import { contactIdsForProperty } from "@/lib/contact-properties";
import { listDocuments } from "@/lib/documents";
import { asKeyProvisions, asLeaseArray } from "@/lib/lease-json";

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
  owner_id: string;
  visibility: "private" | "team";
  source_document: string | null;
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  leased_sf: number | null;
  landlord_name: string | null;
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("lease_abstracts")
    .select("source_document, tenant_contact:contacts!tenant_contact_id(name), properties(address)")
    .eq("id", id)
    .maybeSingle();
  const tenant = (data?.tenant_contact as { name?: string | null } | null)?.name;
  const address = (data?.properties as { address?: string | null } | { address?: string | null }[] | null);
  const addr = Array.isArray(address) ? address[0]?.address : address?.address;
  return { title: tenant || addr ? `${tenant ?? addr} · Beacon` : "Lease abstract · Beacon" };
}

export default async function AbstractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("lease_abstracts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) notFound();

  const abstract = {
    ...(data as LeaseAbstract),
    escalations: asLeaseArray<Escalation>((data as LeaseAbstract).escalations),
    options: asLeaseArray<LeaseOption>((data as LeaseAbstract).options),
    key_provisions: asKeyProvisions((data as LeaseAbstract).key_provisions),
  };

  const propertyContactIds = abstract.linked_property
    ? await contactIdsForProperty(supabase, user.id, abstract.linked_property)
    : [];

  const [{ data: fdData }, { data: tenantContactData }, { data: propertyContactsData }, { data: linkedPropertyData }, pdfUrlResult, leaseDocuments, isSoloFirm] =
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
      propertyContactIds.length > 0
        ? supabase
            .from("contacts")
            .select("id, name, role, company")
            .in("id", propertyContactIds)
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
      listDocuments(supabase, user.id, "lease", id),
      isSoloFirmForUser(supabase, user.id),
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
      initialDocuments={leaseDocuments}
      currentUserId={user.id}
      isSoloFirm={isSoloFirm}
    />
  );
}
