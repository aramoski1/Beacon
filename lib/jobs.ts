export type JobType = "geocode_property" | "ownership_watch_batch" | "enrich_property" | "listing_discover";

export type JobRow = {
  id: string;
  owner_id: string;
  job_type: JobType;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  last_error: string | null;
};

export const JOB_BATCH_SIZE = 10;

type JobInsertClient = {
  from: (table: "background_jobs") => {
    insert: (row: {
      owner_id: string;
      job_type: JobType;
      payload: Record<string, unknown>;
      status: "queued";
    }) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export async function enqueueJob(
  supabase: JobInsertClient,
  ownerId: string,
  jobType: JobType,
  payload: Record<string, unknown> = {},
): Promise<{ error?: string }> {
  const { error } = await supabase.from("background_jobs").insert({
    owner_id: ownerId,
    job_type: jobType,
    payload,
    status: "queued",
  });
  if (error) return { error: error.message };
  return {};
}
