import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnerPortfolioForProperty } from "@/app/owner-portfolio/actions";
import { OwnerPortfolioView } from "@/app/owner-portfolio/owner-portfolio-view";

export default async function OwnerPortfolioPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ person?: string }>;
}) {
  const { id } = await params;
  const { person } = await searchParams;
  const personIndex = person != null && person !== "" ? Number(person) : undefined;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await getOwnerPortfolioForProperty(
    id,
    personIndex != null && !Number.isNaN(personIndex) ? personIndex : undefined,
  );
  if (!data) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <OwnerPortfolioView
        data={data}
        backHref={`/properties/${id}`}
        backLabel="Property"
      />
    </main>
  );
}
