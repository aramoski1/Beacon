import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { listBuyBoxes } from "./actions";
import ProspectView from "./view";

export default async function ProspectPage() {
  const supabase = await createClient();
  await requireUser(supabase);

  const buyBoxes = await listBuyBoxes();

  return <ProspectView initialBuyBoxes={buyBoxes} />;
}
