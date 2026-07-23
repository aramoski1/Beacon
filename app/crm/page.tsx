import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CRMView from "./view";

export const metadata = { title: "Workspace – Beacon" };

export default async function CRMPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: obSettings } = await supabase
    .from("user_settings")
    .select("onboarding_completed_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!obSettings?.onboarding_completed_at) redirect("/onboarding");

  const { tab } = await searchParams;
  return <CRMView initialTab={tab} userEmail={user.email ?? null} />;
}
