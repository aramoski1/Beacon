import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CRMView from "./view";

export const metadata = { title: "CRM – Beacon" };

export default async function CRMPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <CRMView />;
}
