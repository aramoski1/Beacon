import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ErrorsView } from "./view";
import { getIngestionErrors } from "./actions";

export default async function IngestionErrorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = await getIngestionErrors(0);
  const initial = "error" in result ? { rows: [], total: 0 } : result;

  return <ErrorsView initialRows={initial.rows} initialTotal={initial.total} />;
}
