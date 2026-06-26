import { redirect } from "next/navigation";

export default function AbstractsPage() {
  redirect("/crm?tab=leases");
}
