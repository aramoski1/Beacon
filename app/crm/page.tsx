import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { getWorkspaceTeamContext } from "@/lib/firms";
import CRMView from "./view";

export const metadata = { title: "Workspace – Beacon" };

export default async function CRMPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: obSettings } = await supabase
    .from("user_settings")
    .select("onboarding_completed_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!obSettings?.onboarding_completed_at) redirect("/onboarding");

  const { tab } = await searchParams;
  const teamContext = await getWorkspaceTeamContext(supabase, user.id);
  return (
    <Suspense fallback={null}>
      <CRMView
        initialTab={tab}
        userEmail={user.email ?? null}
        userId={user.id}
        isSoloFirm={teamContext.isSoloFirm}
        teammateNames={teamContext.teammateNames}
      />
    </Suspense>
  );
}
