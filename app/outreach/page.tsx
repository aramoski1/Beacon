import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDueContacts } from "./actions";
import OutreachView from "./view";

export default async function OutreachPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [initialContacts, { data: settingsRow }] = await Promise.all([
    getDueContacts(),
    supabase
      .from("user_settings")
      .select("email_provider")
      .eq("owner_id", user.id)
      .maybeSingle(),
  ]);

  return (
    <OutreachView
      initialContacts={initialContacts}
      userEmail={user.email ?? null}
      emailProvider={(settingsRow?.email_provider as string | null) ?? null}
    />
  );
}
