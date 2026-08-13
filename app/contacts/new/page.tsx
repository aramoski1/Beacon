"use client";

import { useState, useTransition, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createContact } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { fetchFieldDefs, fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

const OWNERSHIP_ROLES = [
  { value: "managing_member",   label: "Managing Member" },
  { value: "authorized_signer", label: "Authorized Signer" },
  { value: "registered_agent",  label: "Registered Agent" },
  { value: "principal",         label: "Principal" },
  { value: "other",             label: "Other" },
];

const ASSET_OPTIONS = [
  { value: "industrial",  label: "Industrial" },
  { value: "office",      label: "Office" },
  { value: "retail",      label: "Retail" },
  { value: "multifamily", label: "Multifamily" },
  { value: "land",        label: "Land" },
  { value: "mixed_use",   label: "Mixed Use" },
  { value: "other",       label: "Other" },
];

const RELATIONSHIP_STAGES = [
  { value: "prospect",    label: "Prospect" },
  { value: "active",      label: "Active" },
  { value: "client",      label: "Client" },
  { value: "past_client", label: "Past client" },
  { value: "dormant",     label: "Dormant" },
];

const LEAD_SOURCES = [
  { value: "sunbiz",                label: "Sunbiz" },
  { value: "referral",              label: "Referral" },
  { value: "cold",                  label: "Cold" },
  { value: "costar",                label: "CoStar" },
  { value: "existing_relationship", label: "Existing relationship" },
  { value: "other",                 label: "Other" },
];

const selCls =
  "w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function NewContactInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("property");
  const propertyLabel = searchParams.get("propertyLabel");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [assetFocus, setAssetFocus] = useState<string[]>([]);
  const [customDefs, setCustomDefs] = useState<FieldDefinition[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) fetchFieldDefs(supabase, user.id, "contact").then(setCustomDefs);
    });
  }, []);

  function toggleAsset(val: string) {
    setAssetFocus((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    assetFocus.forEach((v) => formData.append("asset_focus", v));
    if (propertyId) formData.set("linked_properties", propertyId);
    startTransition(async () => {
      const result = await createContact(formData);
      if (result.error) {
        setError(result.error);
      } else if (result.id) {
        router.push(propertyId ? `/properties/${propertyId}` : `/contacts/${result.id}`);
      }
    });
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:px-6 sm:py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Add contact</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a new owner contact to your CRM.
        </p>
        {propertyId && propertyLabel && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-primary">
            <Building2 className="size-3.5 shrink-0" />
            Will be linked to {propertyLabel}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ── Identity ───────────────────────────────────────── */}
        <SectionLabel>Identity</SectionLabel>

        <div className="space-y-1.5">
          <Label htmlFor="name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            placeholder="Jane Smith"
            required
            disabled={isPending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="company">Company (ownership entity)</Label>
          <Input
            id="company"
            name="company"
            placeholder="Acme Industrial LLC"
            disabled={isPending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="title_role">Title / Role</Label>
          <Input
            id="title_role"
            name="title_role"
            placeholder="Managing Member"
            disabled={isPending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="jane@acme.com"
            disabled={isPending}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="phone_mobile">Phone (mobile)</Label>
            <Input
              id="phone_mobile"
              name="phone_mobile"
              type="tel"
              placeholder="(305) 555-0100"
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone_office">Phone (office)</Label>
            <Input
              id="phone_office"
              name="phone_office"
              type="tel"
              placeholder="(305) 555-0200"
              disabled={isPending}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mailing_address">Mailing address</Label>
          <Input
            id="mailing_address"
            name="mailing_address"
            placeholder="123 Main St, Miami, FL 33101"
            disabled={isPending}
          />
        </div>

        {/* ── Ownership Details ───────────────────────────────── */}
        <SectionLabel>Ownership Details</SectionLabel>

        <div className="space-y-1.5">
          <Label htmlFor="ownership_role">Ownership role</Label>
          <select
            id="ownership_role"
            name="ownership_role"
            disabled={isPending}
            className={selCls}
          >
            <option value="">— Select role —</option>
            {OWNERSHIP_ROLES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>Asset focus</Label>
          <div className="flex flex-wrap gap-2">
            {ASSET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleAsset(opt.value)}
                disabled={isPending}
                className={cn(
                  "px-3 py-1 rounded-full border text-sm transition-colors",
                  assetFocus.includes(opt.value)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="submarket">Submarket</Label>
          <Input
            id="submarket"
            name="submarket"
            placeholder="Doral, Medley, Hialeah…"
            disabled={isPending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="portfolio_size">Portfolio size</Label>
          <Input
            id="portfolio_size"
            name="portfolio_size"
            placeholder="5 buildings · ~200,000 sf"
            disabled={isPending}
          />
        </div>

        {/* ── Relationship ────────────────────────────────────── */}
        <SectionLabel>Relationship</SectionLabel>

        <div className="space-y-1.5">
          <Label htmlFor="contact_tier">Contact tier</Label>
          <select
            id="contact_tier"
            name="contact_tier"
            disabled={isPending}
            className={selCls}
          >
            <option value="">— No tier —</option>
            <option value="1">1 — Top priority</option>
            <option value="2">2 — Warm prospect</option>
            <option value="3">3 — Periodic check-in</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="relationship_stage">Relationship stage</Label>
          <select
            id="relationship_stage"
            name="relationship_stage"
            disabled={isPending}
            className={selCls}
          >
            <option value="">— Select stage —</option>
            {RELATIONSHIP_STAGES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lead_source">Lead source</Label>
          <select
            id="lead_source"
            name="lead_source"
            disabled={isPending}
            className={selCls}
          >
            <option value="">— Select source —</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="last_contacted_at">Last contacted</Label>
            <Input
              id="last_contacted_at"
              name="last_contacted_at"
              type="date"
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next_action_due">Next action due</Label>
            <Input
              id="next_action_due"
              name="next_action_due"
              type="date"
              disabled={isPending}
            />
          </div>
        </div>

        {/* ── Notes ──────────────────────────────────────────── */}
        <SectionLabel>Notes</SectionLabel>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            placeholder="Add any notes about this contact…"
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tags">Source / tags (comma-separated)</Label>
          <Input
            id="tags"
            name="tags"
            placeholder="sunbiz, miami-dade, industrial-owner"
            disabled={isPending}
          />
        </div>

        {/* Custom contact fields */}
        {customDefs.length > 0 && (
          <>
            <SectionLabel>Custom fields</SectionLabel>
            {customDefs.map((f) => {
              const slug = fieldSlug(f.field_name);
              const inputName = `cf_${slug}`;
              return (
                <div key={f.id} className="space-y-1.5">
                  <Label htmlFor={inputName}>{f.field_name}</Label>
                  {f.field_type === "select" && f.select_options?.length ? (
                    <select
                      id={inputName}
                      name={inputName}
                      disabled={isPending}
                      className={selCls}
                    >
                      <option value="">— Select —</option>
                      {f.select_options.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={inputName}
                      name={inputName}
                      type={
                        f.field_type === "number"
                          ? "number"
                          : f.field_type === "date"
                          ? "date"
                          : "text"
                      }
                      disabled={isPending}
                    />
                  )}
                </div>
              );
            })}
          </>
        )}

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? (
            <>
              <Loader2 className="animate-spin" />
              Saving…
            </>
          ) : (
            "Add contact"
          )}
        </Button>
      </form>
    </div>
  );
}

export default function NewContactPage() {
  return (
    <Suspense>
      <NewContactInner />
    </Suspense>
  );
}
