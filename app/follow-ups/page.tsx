import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFollowUps } from "./actions";
import { FollowUpsView } from "./view";

export const metadata = { title: "Follow-ups – Beacon" };

export default async function FollowUpsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const followUps = await getFollowUps("open");
  return <FollowUpsView initialFollowUps={followUps} />;
}
