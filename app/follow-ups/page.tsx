import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { getFollowUps } from "./actions";
import { FollowUpsView } from "./view";

export const metadata = { title: "Follow-ups – Beacon" };

export default async function FollowUpsPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const followUps = await getFollowUps("open");
  return <FollowUpsView initialFollowUps={followUps} userEmail={user.email ?? null} />;
}
