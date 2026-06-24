import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDueContacts } from "./actions";
import OutreachView from "./view";

export default async function OutreachPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const initialContacts = await getDueContacts();

  return <OutreachView initialContacts={initialContacts} userEmail={user?.email ?? null} />;
}
