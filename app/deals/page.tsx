import { redirect } from "next/navigation";
import { Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDeals, getDealsForecast } from "./actions";
import { DealsView } from "./deals-view";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const [deals, forecast] = await Promise.all([getDeals(), getDealsForecast()]);
  const totalCount = deals.length;

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 max-w-[100rem] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Briefcase className="size-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold tracking-tight">Deals</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totalCount === 0
              ? "Track your pursuit pipeline — from prospect to close."
              : `${totalCount} pursuit${totalCount === 1 ? "" : "s"} tracked`}
          </p>
        </div>
      </div>

      <DealsView initialDeals={deals} initialForecast={forecast} autoOpenCreate={sp.new === "1"} />
    </div>
  );
}
