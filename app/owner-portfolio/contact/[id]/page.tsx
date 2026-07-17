import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnerPortfolioForContact } from "@/app/owner-portfolio/actions";
import { OwnerPortfolioView } from "@/app/owner-portfolio/owner-portfolio-view";

export default async function OwnerPortfolioContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await getOwnerPortfolioForContact(id);
  if (!data) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <OwnerPortfolioView
        data={data}
        backHref={`/contacts/${id}`}
        backLabel="Contact"
      />
    </main>
  );
}
