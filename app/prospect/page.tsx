import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listBuyBoxes } from "./actions";
import ProspectView from "./view";

export default async function ProspectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const buyBoxes = await listBuyBoxes();

  return <ProspectView initialBuyBoxes={buyBoxes} />;
}
