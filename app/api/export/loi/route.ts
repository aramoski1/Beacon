import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/app/settings/actions";
import { buildLoiDocx, loiFileName } from "@/lib/loi-template";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const dealId = new URL(req.url).searchParams.get("deal");
  if (!dealId) return new Response("Missing deal", { status: 400 });

  const { data: deal } = await supabase
    .from("deals")
    .select("name, deal_type, stage, estimated_commission, notes, expected_close_date, contacts(name, company), properties(address)")
    .eq("id", dealId)
    .single();

  if (!deal) return new Response("Not found", { status: 404 });

  const settings = await getUserSettings();
  const bytes = await buildLoiDocx({
    deal: {
      name: deal.name,
      deal_type: deal.deal_type,
      stage: deal.stage,
      estimated_commission: deal.estimated_commission,
      notes: deal.notes,
      expected_close_date: deal.expected_close_date,
    },
    propertyAddress: (deal.properties as unknown as { address: string | null } | null)?.address ?? null,
    contactName: (deal.contacts as unknown as { name: string | null; company: string | null } | null)?.name ?? null,
    contactCompany: (deal.contacts as unknown as { name: string | null; company: string | null } | null)?.company ?? null,
    brokerName: settings.display_name || settings.broker_name,
    company: settings.company,
  });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${loiFileName(deal.name)}"`,
    },
  });
}
