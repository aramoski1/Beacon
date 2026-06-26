"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Building2, CheckCircle2, UserPlus } from "lucide-react";
import { getDashboardDelta, type DashboardDelta } from "./actions";

const STORAGE_KEY = "beacon_last_dashboard_visit";

function fmtSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function SinceLastVisit() {
  const [delta, setDelta] = useState<DashboardDelta | null>(null);
  const [sinceLabel, setSinceLabel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const since = localStorage.getItem(STORAGE_KEY);
    if (since) {
      setSinceLabel(fmtSince(since));
      getDashboardDelta(since).then((d) => {
        setDelta(d);
        setLoaded(true);
      });
    } else {
      setLoaded(true);
    }
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  }, []);

  if (!loaded || !sinceLabel || !delta) return null;

  const total =
    delta.propertiesAdded + delta.contactsAdded + delta.followUpsCompleted + delta.activities.length;
  if (total === 0) return null;

  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Since your last visit ({sinceLabel})
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-2">
        {delta.propertiesAdded > 0 && (
          <span><span className="font-semibold text-foreground">{delta.propertiesAdded}</span> propert{delta.propertiesAdded === 1 ? "y" : "ies"} added</span>
        )}
        {delta.contactsAdded > 0 && (
          <span><span className="font-semibold text-foreground">{delta.contactsAdded}</span> contact{delta.contactsAdded === 1 ? "" : "s"} added</span>
        )}
        {delta.followUpsCompleted > 0 && (
          <span><span className="font-semibold text-foreground">{delta.followUpsCompleted}</span> follow-up{delta.followUpsCompleted === 1 ? "" : "s"} cleared</span>
        )}
        {delta.activities.length > 0 && (
          <span><span className="font-semibold text-foreground">{delta.activities.length}</span> touchpoint{delta.activities.length === 1 ? "" : "s"}</span>
        )}
      </div>
      {delta.activities.length > 0 && (
        <ul className="space-y-1.5 border-t pt-2">
          {delta.activities.slice(0, 4).map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-xs">
              <Activity className="size-3 text-muted-foreground shrink-0" />
              {a.contact_name && (
                <Link href={`/contacts/${a.contact_id}`} className="font-medium hover:underline underline-offset-2">
                  {a.contact_name}
                </Link>
              )}
              <span className="text-muted-foreground capitalize">{a.activity_type}</span>
              {a.property_address && a.property_id && (
                <Link href={`/properties/${a.property_id}`} className="text-muted-foreground hover:text-foreground truncate ml-auto">
                  {a.property_address}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
