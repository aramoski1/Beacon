"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createTour, updateTourStatus, type TourRow } from "./actions";
import { stripDemoLabel } from "@/lib/demo-display";
import { formatLocalDateTime } from "@/lib/dates";

function fmtTourWhen(iso: string): string {
  return formatLocalDateTime(iso) ?? iso;
}

export function ToursView({
  tours,
  properties,
  contacts,
}: {
  tours: TourRow[];
  properties: { id: string; address: string | null }[];
  contacts: { id: string; name: string | null }[];
}) {
  const [pending, start] = useTransition();
  const [scheduledAt, setScheduledAt] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [propertyQuery, setPropertyQuery] = useState("");
  const [contactId, setContactId] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const upcoming = tours.filter((t) => t.status === "scheduled");
  const past = tours.filter((t) => t.status !== "scheduled");

  return (
    <div className="space-y-8">
      <form
        className="rounded-xl border bg-card p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const res = await createTour({
              scheduledAt,
              propertyId: propertyId || null,
              contactId: contactId || null,
              attendees: attendees || null,
              notes: notes || null,
            });
            if (res.error) setError(res.error);
            else {
              setScheduledAt("");
              setAttendees("");
              setNotes("");
            }
          });
        }}
      >
        <p className="text-sm font-medium">Schedule a tour</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          />
          <div>
            <input
              list="tour-properties"
              value={propertyQuery}
              onChange={(e) => {
                setPropertyQuery(e.target.value);
                const hit = properties.find((p) => (p.address ?? "") === e.target.value);
                setPropertyId(hit?.id ?? "");
              }}
              placeholder="Search property…"
              className="text-sm border rounded-md px-2 py-1.5 bg-background w-full"
            />
            <datalist id="tour-properties">
              {properties.map((p) => (
                <option key={p.id} value={p.address ?? p.id} />
              ))}
            </datalist>
          </div>
          <div>
            <input
              list="tour-contacts"
              value={contactQuery}
              onChange={(e) => {
                setContactQuery(e.target.value);
                const hit = contacts.find((c) => (c.name ?? "") === e.target.value);
                setContactId(hit?.id ?? "");
              }}
              placeholder="Search contact…"
              className="text-sm border rounded-md px-2 py-1.5 bg-background w-full"
            />
            <datalist id="tour-contacts">
              {contacts.map((c) => (
                <option key={c.id} value={c.name ?? c.id} />
              ))}
            </datalist>
          </div>
          <input
            placeholder="Attendees"
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          />
          <input
            placeholder="Prep notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="sm:col-span-2 text-sm border rounded-md px-2 py-1.5 bg-background"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="text-xs font-medium rounded-md bg-primary text-primary-foreground px-3 py-1.5 disabled:opacity-50"
        >
          Save tour
        </button>
      </form>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Upcoming</h2>
        {upcoming.length === 0 && <p className="text-sm text-muted-foreground">None scheduled.</p>}
        <ul className="divide-y rounded-xl border bg-card">
          {upcoming.map((t) => (
            <li key={t.id} className="px-4 py-3 flex flex-wrap items-center gap-2 justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {fmtTourWhen(t.scheduled_at)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.properties?.address ?? "No property"}
                  {t.contacts?.name ? ` · ${t.contacts.name}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {t.property_id && (
                  <Link href={`/properties/${t.property_id}`} className="text-xs text-primary underline-offset-4 hover:underline">
                    Property
                  </Link>
                )}
                <button
                  type="button"
                  className="text-xs border rounded-md px-2 py-1"
                  onClick={() => start(async () => {
                    const outcome = window.prompt("What happened on the tour? (optional)");
                    await updateTourStatus(t.id, "completed", outcome?.trim() || null);
                  })}
                >
                  Mark done
                </button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground"
                  onClick={() => start(async () => { await updateTourStatus(t.id, "cancelled"); })}
                >
                  Cancel
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Past</h2>
          <ul className="text-sm text-muted-foreground space-y-1">
            {past.map((t) => (
              <li key={t.id} className="space-y-1">
                <p>
                  {fmtTourWhen(t.scheduled_at)} — {t.status}
                  {t.properties?.address ? ` · ${t.properties.address}` : ""}
                </p>
                {t.post_tour_notes ? (
                  <p className="text-xs">{stripDemoLabel(t.post_tour_notes) ?? t.post_tour_notes}</p>
                ) : t.status === "completed" ? (
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => start(async () => {
                      const outcome = window.prompt("What happened on the tour?");
                      if (outcome?.trim()) await updateTourStatus(t.id, "completed", outcome.trim());
                    })}
                  >
                    Add outcome
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
