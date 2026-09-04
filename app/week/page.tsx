import { ListTodo } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { getWeeklyList } from "./actions";
import { WeekListView } from "./view";

export const metadata = { title: "This week – Beacon" };

export default async function WeekPage() {
  const supabase = await createClient();
  await requireUser(supabase);
  const state = await getWeeklyList();

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ListTodo className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">This week</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Your weekly call and merge block. Pin an Owners or Tenants smart list, work the list, then generate drafts.
        </p>
      </div>
      <WeekListView initial={state} />
    </div>
  );
}
