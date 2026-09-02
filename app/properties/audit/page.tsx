import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import AuditView from "./view";

export const metadata = { title: "Data audit – Beacon" };

export default async function AuditPage() {
  const supabase = await createClient();
  await requireUser(supabase);
  return <AuditView />;
}
