import { notFound, redirect } from "next/navigation";
import { FileText, CalendarDays, Clock, DollarSign, TrendingUp, Key, BookOpen, Quote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

// ─── Local types for JSONB fields ─────────────────────────────────────────────

type Escalation = { description: string; rate: string; effective_date?: string };
type LeaseOption = { type: "renewal" | "termination" | "expansion"; description: string; notice_period?: string };
type KeyProvision = { provision: string; citation?: string };
type FieldCitation = { field: string; page: string; text: string };

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
  custom_fields: Record<string, string | number | null> | null;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function optionVariant(type: string): "default" | "secondary" | "outline" {
  if (type === "renewal") return "default";
  if (type === "termination") return "secondary";
  return "outline";
}

function sourceFileName(path: string | null) {
  if (!path) return "Unknown file";
  return path.split("/").pop() ?? path;
}

function truncate(text: string, max = 120) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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

  const { data: fdData } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", "lease")
    .order("created_at", { ascending: true });
  const customDefs = (fdData ?? []) as FieldDefinition[];
  const customValues = abstract.custom_fields ?? {};

  // Citation lookup by field name — O(1) access per field display
  const citationMap = new Map<string, FieldCitation>(
    (abstract.field_citations ?? []).map((c) => [c.field, c])
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      {/* Back link */}
      <a href="/abstracts" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Lease abstracts
      </a>

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Lease abstract</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileText className="size-3.5" />
            {sourceFileName(abstract.source_document)}
          </p>
        </div>
        <Badge variant="outline" className="mt-1 shrink-0">AI Abstracted</Badge>
      </div>

      {/* Summary card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
            <SummaryField
              icon={<CalendarDays className="size-4" />}
              label="Execution date"
              value={formatDate(abstract.execution_date)}
              citation={citationMap.get("execution_date")}
            />
            <SummaryField
              icon={<CalendarDays className="size-4" />}
              label="Expiration date"
              value={formatDate(abstract.expiration_date)}
              citation={citationMap.get("expiration_date")}
            />
            <SummaryField
              icon={<Clock className="size-4" />}
              label="Term"
              value={abstract.term ?? "—"}
              citation={citationMap.get("term")}
            />
            <SummaryField
              icon={<DollarSign className="size-4" />}
              label="Base rate"
              value={
                abstract.base_rate != null
                  ? `$${abstract.base_rate.toLocaleString()}`
                  : "—"
              }
              citation={citationMap.get("base_rate")}
            />
          </dl>
        </CardContent>
      </Card>

      {/* Escalations */}
      {abstract.escalations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4" />
              Escalations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {abstract.escalations.map((e, i) => {
              // Citations for escalation items may be keyed as "escalations[N]" or "escalations"
              const cit = citationMap.get(`escalations[${i}]`) ?? (i === 0 ? citationMap.get("escalations") : undefined);
              return (
                <div key={i}>
                  {i > 0 && <Separator className="mb-3" />}
                  <p className="font-medium text-sm">{e.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.rate}
                    {e.effective_date ? ` · effective ${e.effective_date}` : ""}
                  </p>
                  {cit && <CitationLine citation={cit} />}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Options */}
      {abstract.options.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="size-4" />
              Options
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {abstract.options.map((o, i) => {
              const cit = citationMap.get(`options[${i}]`) ?? (i === 0 ? citationMap.get("options") : undefined);
              return (
                <div key={i} className="flex gap-3">
                  <Badge variant={optionVariant(o.type)} className="mt-0.5 shrink-0 capitalize">
                    {o.type}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm">{o.description}</p>
                    {o.notice_period && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Notice: {o.notice_period}
                      </p>
                    )}
                    {cit && <CitationLine citation={cit} />}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Key provisions */}
      {abstract.key_provisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4" />
              Key Provisions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {abstract.key_provisions.map((kp, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                  <div className="min-w-0">
                    <span>{kp.provision}</span>
                    {kp.citation && (
                      <span className="ml-1.5 text-xs font-mono text-muted-foreground">
                        ({kp.citation})
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Custom fields */}
      {customDefs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">Custom fields</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
              {customDefs.map(f => {
                const slug = fieldSlug(f.field_name);
                const val  = customValues[slug];
                const cit  = citationMap.get(slug) ?? citationMap.get(f.field_name);
                return (
                  <div key={f.id} className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {f.field_name}
                    </dt>
                    <dd className="text-sm font-medium">
                      {val != null ? String(val) : "—"}
                    </dd>
                    {cit && <CitationLine citation={cit} />}
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Field citations — full reference table */}
      {abstract.field_citations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Quote className="size-4" />
              Source citations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 pr-4 font-medium">Field</th>
                  <th className="pb-2 pr-4 font-medium">Page</th>
                  <th className="pb-2 font-medium">Source text</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {abstract.field_citations.map((c, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4 font-mono text-muted-foreground whitespace-nowrap">
                      {c.field}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                      {c.page}
                    </td>
                    <td className="py-2 text-foreground/80 italic">"{c.text}"</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryField({
  icon,
  label,
  value,
  citation,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  citation?: FieldCitation;
}) {
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {icon}
        {label}
      </dt>
      <dd className="text-sm font-medium">{value}</dd>
      {citation && <CitationLine citation={citation} />}
    </div>
  );
}

function CitationLine({ citation }: { citation: FieldCitation }) {
  return (
    <p className="text-xs text-muted-foreground/70 italic leading-snug mt-0.5">
      p.&thinsp;{citation.page} · &ldquo;{truncate(citation.text)}&rdquo;
    </p>
  );
}
