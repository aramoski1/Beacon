import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { ErrorsView } from "./view";
import { getIngestionErrors } from "./actions";

export default async function IngestionErrorsPage() {
  const supabase = await createClient();
  await requireUser(supabase);

  const result = await getIngestionErrors(0);
  const initial = "error" in result ? { rows: [], total: 0 } : result;

  return <ErrorsView initialRows={initial.rows} initialTotal={initial.total} />;
}
