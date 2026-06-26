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
  const { tab } = await searchParams;
  return <CRMView initialTab={tab} userEmail={user.email ?? null} />;
}
