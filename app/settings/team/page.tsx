import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTeamData } from "./actions";
import { TeamView } from "./team-view";

export const metadata = { title: "Team – Beacon" };

export default async function TeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await getTeamData();

  return <TeamView data={data} />;
}
