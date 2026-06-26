import { redirect } from "next/navigation";
export default function PropertyUploadPage() {
  redirect("/properties/new?method=upload");
}
