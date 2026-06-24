import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AuditView from "./view";

export const metadata = { title: "Data audit – Beacon" };

export default async function AuditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <AuditView />;
}
