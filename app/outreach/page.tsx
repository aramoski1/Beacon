import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { getDueContacts } from "./actions";
import OutreachView from "./view";

export default async function OutreachPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const [initialContacts, { data: settingsRow }] = await Promise.all([
    getDueContacts(),
    supabase
      .from("user_settings")
      .select("email_provider, sender_name, display_name")
      .eq("owner_id", user.id)
      .maybeSingle(),
  ]);

  const senderName =
    ((settingsRow?.sender_name || settingsRow?.display_name) as string | null) ?? null;

  return (
    <OutreachView
      initialContacts={initialContacts}
      userEmail={user.email ?? null}
      emailProvider={(settingsRow?.email_provider as string | null) ?? null}
      senderName={senderName}
    />
  );
}
