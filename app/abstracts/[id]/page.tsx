import { notFound, redirect } from "next/navigation";
import { FileText, CalendarDays, Clock, DollarSign, TrendingUp, Key, BookOpen } from "lucide-react";
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lease Abstract</h1>
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
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <SummaryField
              icon={<CalendarDays className="size-4" />}
              label="Execution date"
              value={formatDate(abstract.execution_date)}
            />
            <SummaryField
              icon={<CalendarDays className="size-4" />}
              label="Expiration date"
              value={formatDate(abstract.expiration_date)}
            />
            <SummaryField
              icon={<Clock className="size-4" />}
              label="Term"
              value={abstract.term ?? "—"}
            />
            <SummaryField
              icon={<DollarSign className="size-4" />}
              label="Base rate"
              value={
                abstract.base_rate != null
                  ? `$${abstract.base_rate.toLocaleString()}`
                  : "—"
              }
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
            {abstract.escalations.map((e, i) => (
              <div key={i}>
                {i > 0 && <Separator className="mb-3" />}
                <p className="font-medium text-sm">{e.description}</p>
                <p className="text-sm text-muted-foreground">
                  {e.rate}
                  {e.effective_date ? ` · effective ${e.effective_date}` : ""}
                </p>
              </div>
            ))}
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
            {abstract.options.map((o, i) => (
              <div key={i} className="flex gap-3">
                <Badge variant={optionVariant(o.type)} className="mt-0.5 shrink-0 capitalize">
                  {o.type}
                </Badge>
                <div>
                  <p className="text-sm">{o.description}</p>
                  {o.notice_period && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Notice: {o.notice_period}
                    </p>
                  )}
                </div>
              </div>
            ))}
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
            <ul className="space-y-2">
              {abstract.key_provisions.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                  <span>
                    {p.provision}
                    {p.citation && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({p.citation})
                      </span>
                    )}
                  </span>
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
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
              {customDefs.map(f => {
                const slug = fieldSlug(f.field_name);
                const val  = customValues[slug];
                return (
                  <div key={f.id} className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {f.field_name}
                    </dt>
                    <dd className="text-sm font-medium">
                      {val != null ? String(val) : "—"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Field citations */}
      {abstract.field_citations.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors list-none flex items-center gap-1.5">
            <span className="text-xs">▶</span>
            <span className="group-open:hidden">Show source citations</span>
            <span className="hidden group-open:inline">Hide source citations</span>
          </summary>
          <Card className="mt-3">
            <CardContent className="pt-4">
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
        </details>
      )}
    </main>
  );
}

// ─── Sub-component ────────────────────────────────────────────────────────────

function SummaryField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {icon}
        {label}
      </dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
