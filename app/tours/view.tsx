"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createTour, updateTourStatus, type TourRow } from "./actions";

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
  const [contactId, setContactId] = useState("");
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
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">Property (optional)</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.address ?? p.id}</option>
            ))}
          </select>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">Contact (optional)</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name ?? c.id}</option>
            ))}
          </select>
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
                  {new Date(t.scheduled_at).toLocaleString()}
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
                  onClick={() => start(async () => { await updateTourStatus(t.id, "completed"); })}
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
              <li key={t.id}>
                {new Date(t.scheduled_at).toLocaleDateString()} — {t.status}
                {t.properties?.address ? ` · ${t.properties.address}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
