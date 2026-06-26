import { redirect } from "next/navigation";
export default function PropertyUrlPage() {
  redirect("/properties/new?method=url");
}
