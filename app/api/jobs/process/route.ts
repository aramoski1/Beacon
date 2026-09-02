import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { JOB_BATCH_SIZE, type JobRow } from "@/lib/jobs";
import { geocodeMissingProperties } from "@/app/book-map/geocode-actions";
import { runOwnershipWatchBatch } from "@/app/properties/[id]/actions";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: jobs } = await supabase
    .from("background_jobs")
    .select("id, job_type, payload, attempts")
    .eq("owner_id", user.id)
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(JOB_BATCH_SIZE);

  const processed: { id: string; ok: boolean }[] = [];
  for (const job of (jobs ?? []) as Pick<JobRow, "id" | "job_type" | "payload" | "attempts">[]) {
    await supabase.from("background_jobs").update({ status: "running", attempts: job.attempts + 1 }).eq("id", job.id);
    try {
      if (job.job_type === "geocode_property") {
        await geocodeMissingProperties(15);
      } else if (job.job_type === "ownership_watch_batch") {
        await runOwnershipWatchBatch(10);
      }
      await supabase
        .from("background_jobs")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", job.id);
      processed.push({ id: job.id, ok: true });
    } catch (e) {
      await supabase
        .from("background_jobs")
        .update({
          status: "failed",
          last_error: e instanceof Error ? e.message : String(e),
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      processed.push({ id: job.id, ok: false });
    }
  }

  return NextResponse.json({ processed: processed.length, jobs: processed });
}
