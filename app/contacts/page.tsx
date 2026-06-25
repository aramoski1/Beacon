import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getContacts } from "./actions";
import { ContactsView } from "./view";

export const metadata = { title: "Contacts – Beacon" };

export default async function ContactsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const contacts = await getContacts();
  return <ContactsView contacts={contacts} />;
}
