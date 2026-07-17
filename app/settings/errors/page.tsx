import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getErrorLogs } from "./actions";
import { ErrorLogsView } from "./view";

export default async function ErrorLogsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
