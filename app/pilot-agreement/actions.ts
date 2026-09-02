"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { withAction } from "@/lib/logger";

export async function acceptPilotAgreement(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const supabase = await createClient();
  const user = await requireUser(supabase, { skipPilotAgreement: true });

  return withAction(
    "acceptPilotAgreement",
    async () => {
      const accepted = formData.get("pilot_agreement") === "on";
      if (!accepted) {
        return { error: "Please accept the pilot agreement to continue." };
      }

      const { error } = await supabase.from("user_settings").upsert(
        {
          owner_id: user.id,
          pilot_agreement_accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
      if (error) return { error: error.message };

      revalidatePath("/", "layout");
      redirect("/dashboard");
    },
    { userId: user.id },
  );
}
