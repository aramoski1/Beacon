import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { getTeamData } from "./actions";
import { TeamView } from "./team-view";

export const metadata = { title: "Team – Beacon" };

export default async function TeamPage() {
  const supabase = await createClient();
  await requireUser(supabase);

  const data = await getTeamData();

  return <TeamView data={data} />;
}
