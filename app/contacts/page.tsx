import { redirect } from "next/navigation";

export default function ContactsPage() {
  redirect("/crm?tab=contacts");
}
