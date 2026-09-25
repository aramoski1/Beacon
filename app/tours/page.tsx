import { CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { listTours } from "./actions";
import { ToursView } from "./view";

export const metadata = { title: "Tours – Beacon" };

export default async function ToursPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const [tours, { data: properties }, { data: contacts }] = await Promise.all([
    listTours(),
    supabase.from("properties").select("id, address").eq("owner_id", user.id).order("address").limit(200),
    supabase.from("contacts").select("id, name").eq("owner_id", user.id).order("name").limit(200),
  ]);

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">Tours</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Schedule property tours with attendees and prep notes. Calendar sync is not available in this build.
        </p>
      </div>
      <ToursView
        tours={tours}
        properties={properties ?? []}
        contacts={contacts ?? []}
      />
    </div>
  );
}
