"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createContact } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { fetchFieldDefs, fieldSlug, type FieldDefinition } from "@/lib/custom-fields";

export default function NewContactPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [customDefs, setCustomDefs] = useState<FieldDefinition[]>([]);

  useEffect(() => {
    const supabase = createClient();
    fetchFieldDefs(supabase, "contact").then(setCustomDefs);
  }, []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createContact(formData);
      if (result.error) {
        setError(result.error);
      } else if (result.id) {
        router.push(`/contacts/${result.id}`);
      }
    });
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add contact</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a new contact to your CRM.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div className="space-y-1.5">
          <Label htmlFor="name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="Jane Smith"
            required
            disabled={isPending}
          />
        </div>

        {/* Company */}
        <div className="space-y-1.5">
          <Label htmlFor="company">Company</Label>
          <Input
            id="company"
            name="company"
            type="text"
            placeholder="Acme Properties LLC"
            disabled={isPending}
          />
        </div>

        {/* Role */}
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <Input
            id="role"
            name="role"
            type="text"
            placeholder="Owner / Asset Manager"
            disabled={isPending}
          />
        </div>

        {/* Email */}
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

        {/* Phone */}
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            placeholder="(305) 555-0100"
            disabled={isPending}
          />
        </div>

        {/* Tier */}
        <div className="space-y-1.5">
          <Label htmlFor="contact_tier">Tier</Label>
          <select
            id="contact_tier"
            name="contact_tier"
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
          >
            <option value="">— No tier —</option>
            <option value="1">1 — Top priority</option>
            <option value="2">2 — Warm prospect</option>
            <option value="3">3 — Periodic check-in</option>
          </select>
        </div>

        {/* Mailing address */}
        <div className="space-y-1.5">
          <Label htmlFor="mailing_address">Mailing address</Label>
          <Input
            id="mailing_address"
            name="mailing_address"
            type="text"
            placeholder="123 Main St, Miami, FL 33101"
            disabled={isPending}
          />
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <Label htmlFor="client_status">Status</Label>
          <select
            id="client_status"
            name="client_status"
            disabled={isPending}
            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
          >
            <option value="">— No status —</option>
            <option value="prospect">Prospect</option>
            <option value="active client">Active client</option>
            <option value="past client">Past client</option>
          </select>
        </div>

        {/* Custom contact fields */}
        {customDefs.map(f => {
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
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background"
                >
                  <option value="">— Select —</option>
                  {f.select_options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <Input
                  id={inputName}
                  name={inputName}
                  type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                  disabled={isPending}
                />
              )}
            </div>
          );
        })}

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
