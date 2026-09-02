import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { getApprovedEmails, getPendingAccessRequests, getAllAccounts } from "./actions";
import AdminView from "./view";

export default async function AdminPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: settings } = await supabase
    .from("user_settings")
    .select("is_admin")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!settings?.is_admin) redirect("/dashboard");

  function okOr<T>(result: T[] | { error: string }): T[] {
    return Array.isArray(result) ? result : [];
  }

  const [approvedEmails, accessRequests, accounts] = await Promise.all([
    getApprovedEmails(),
    getPendingAccessRequests(),
    getAllAccounts(),
  ]);

  return (
    <AdminView
      initialApprovedEmails={okOr(approvedEmails)}
      initialAccessRequests={okOr(accessRequests)}
      initialAccounts={okOr(accounts)}
    />
  );
}
