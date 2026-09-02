import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { getErrorLogs } from "./actions";
import { ErrorLogsView } from "./view";

export default async function ErrorLogsPage() {
  const supabase = await createClient();
  await requireUser(supabase);

  const result = await getErrorLogs("unresolved", 0);
  const rows  = "error" in result ? [] : result.rows;
  const total = "error" in result ? 0  : result.total;

  return (
    <ErrorLogsView
      initialRows={rows}
      initialTotal={total}
      initialFilter="unresolved"
    />
  );
}
