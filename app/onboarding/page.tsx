import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { OnboardingWizard } from "./wizard";

export const metadata = { title: "Welcome to Beacon" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: settings } = await supabase
    .from("user_settings")
    .select("onboarding_completed_at")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (settings?.onboarding_completed_at) redirect("/dashboard");

  return <OnboardingWizard />;
}
