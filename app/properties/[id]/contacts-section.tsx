"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Users, Plus, Loader2, Phone, Mail, MapPin, UserPlus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createContact } from "@/app/contacts/new/actions";
import { createOwnerContact } from "./actions";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LinkedContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  mailing_address: string | null;
  company: string | null;
  role: string | null;
  contact_tier: number | null;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PropertyContactsSection({
  propertyId,
  initialContacts,
  ownerName,
  ownerMailingAddress,
  isMdpa,
}: {
  propertyId: string;
  initialContacts: LinkedContact[];
  ownerName?: string | null;
  ownerMailingAddress?: string | null;
  isMdpa?: boolean;
}) {
  const [contacts, setContacts] = useState<LinkedContact[]>(initialContacts);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Owner contact creation state
  const [creatingOwner, setCreatingOwner] = useState(false);
  const [ownerCreated, setOwnerCreated] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);

  async function handleCreateOwnerContact() {
    setCreatingOwner(true);
    setOwnerError(null);
    const result = await createOwnerContact(propertyId);
    setCreatingOwner(false);
    if (result.error) {
      setOwnerError(result.error);
      return;
    }
    setContacts((prev) => [
      ...prev,
      {
        id: result.id!,
        name: ownerName ?? null,
        email: null,
        phone: null,
        mailing_address: ownerMailingAddress ?? null,
        company: null,
        role: null,
        contact_tier: null,
      },
    ]);
    setOwnerCreated(true);
  }

  function tierLabel(t: number | null) {
    if (t === 1) return "Tier 1";
    if (t === 2) return "Tier 2";
    if (t === 3) return "Tier 3";
    return null;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("linked_properties", propertyId);

    startTransition(async () => {
      const result = await createContact(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      const newContact: LinkedContact = {
        id: result.id!,
        name: (formData.get("name") as string)?.trim() || null,
        email: (formData.get("email") as string)?.trim() || null,
        phone: (formData.get("phone") as string)?.trim() || null,
        mailing_address: (formData.get("mailing_address") as string)?.trim() || null,
        company: (formData.get("company") as string)?.trim() || null,
        role: (formData.get("role") as string)?.trim() || null,
        contact_tier: formData.get("contact_tier") ? Number(formData.get("contact_tier")) : null,
      };
      setContacts((prev) => [...prev, newContact]);
      setShowForm(false);
      form.reset();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="size-4" />
          Contacts
          {contacts.length > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({contacts.length})
            </span>
          )}
        </CardTitle>
        <button
          onClick={() => { setShowForm((v) => !v); setError(null); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showForm ? (
            <><X className="size-3.5" />Cancel</>
          ) : (
            <><Plus className="size-3.5" />Add contact</>
          )}
        </button>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* One-click owner contact — only for MDPA records with a known owner */}
        {isMdpa && ownerName && !ownerCreated && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Owner from MDPA record
              </p>
              <p className="text-sm font-medium mt-0.5 truncate">{ownerName}</p>
              {ownerMailingAddress && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{ownerMailingAddress}</p>
              )}
              {ownerError && (
                <p className="text-xs text-destructive mt-1">{ownerError}</p>
              )}
            </div>
            <button
              onClick={handleCreateOwnerContact}
              disabled={creatingOwner}
              className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {creatingOwner
                ? <><Loader2 className="size-3.5 animate-spin" />Creating…</>
                : <><UserPlus className="size-3.5" />Create contact</>}
            </button>
          </div>
        )}
        {isMdpa && ownerName && ownerCreated && (
          <p className="text-xs text-muted-foreground italic">
            Owner contact created — tagged <span className="font-mono">mdpa_mailing</span> and <span className="font-mono">unverified</span>.
          </p>
        )}

        {/* Contact list */}
        {contacts.length === 0 && !showForm && !isMdpa && (
          <p className="text-sm text-muted-foreground">No contacts linked to this property.</p>
        )}
        {contacts.length === 0 && !showForm && isMdpa && !ownerName && (
          <p className="text-sm text-muted-foreground">No contacts linked to this property.</p>
        )}
        {contacts.length > 0 && (
          <div className="space-y-2">
            {contacts.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="font-medium text-sm hover:underline underline-offset-2"
                      >
                        {c.name ?? "Unknown contact"}
                      </Link>
                      {tierLabel(c.contact_tier) && (
                        <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          {tierLabel(c.contact_tier)}
                        </span>
                      )}
                    </div>

                    {(c.company || c.role) && (
                      <p className="text-xs text-muted-foreground">
                        {[c.role, c.company].filter(Boolean).join(" · ")}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
                        >
                          <Mail className="size-3 shrink-0" />
                          {c.email}
                        </a>
                      )}
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Phone className="size-3 shrink-0" />
                          {c.phone}
                        </a>
                      )}
                      {c.mailing_address && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3 shrink-0" />
                          {c.mailing_address}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Inline add-contact form */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="rounded-lg border p-4 space-y-3 bg-muted/10"
          >
            <p className="text-sm font-medium">New contact</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pc-name" className="text-xs">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="pc-name"
                  name="name"
                  required
                  disabled={isPending}
                  placeholder="Jane Smith"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pc-company" className="text-xs">Company</Label>
                <Input
                  id="pc-company"
                  name="company"
                  disabled={isPending}
                  placeholder="Acme Properties LLC"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pc-role" className="text-xs">Role</Label>
                <Input
                  id="pc-role"
                  name="role"
                  disabled={isPending}
                  placeholder="Owner / Asset Manager"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pc-tier" className="text-xs">Tier</Label>
                <select
                  id="pc-tier"
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

              <div className="space-y-1">
                <Label htmlFor="pc-email" className="text-xs">Email</Label>
                <Input
                  id="pc-email"
                  name="email"
                  type="email"
                  disabled={isPending}
                  placeholder="jane@acme.com"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pc-phone" className="text-xs">Phone</Label>
                <Input
                  id="pc-phone"
                  name="phone"
                  type="tel"
                  disabled={isPending}
                  placeholder="(305) 555-0100"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="pc-address" className="text-xs">Mailing address</Label>
                <Input
                  id="pc-address"
                  name="mailing_address"
                  disabled={isPending}
                  placeholder="123 Main St, Miami, FL 33101"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={isPending} size="sm">
                {isPending ? (
                  <><Loader2 className="size-3.5 animate-spin" />Saving…</>
                ) : (
                  "Add contact"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => { setShowForm(false); setError(null); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
