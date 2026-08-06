/**
 * Delete an auth.users row via direct Postgres (DATABASE_URL).
 * Hosted Supabase Auth Admin needs a service role key we don't ship;
 * postgres can DELETE auth.users (same pattern as pilot email confirm).
 *
 * Import only from server actions / server modules.
 */
import { Client } from "pg";

export async function deleteAuthUserById(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      ok: false,
      error:
        "DATABASE_URL is not configured. Your CRM data may already be deleted, but the login could not be removed.",
    };
  }
  if (!userId.trim()) {
    return { ok: false, error: "Missing user id." };
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const { rowCount } = await client.query(
      `delete from auth.users where id = $1::uuid`,
      [userId.trim()]
    );
    if ((rowCount ?? 0) === 0) {
      return {
        ok: false,
        error:
          "Login user was not found in auth. Your CRM data may already be deleted.",
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[deleteAuthUserById]", err);
    const message = err instanceof Error ? err.message : "Unknown database error";
    return {
      ok: false,
      error: `Failed to delete login: ${message}. Your CRM data may already be gone.`,
    };
  } finally {
    await client.end().catch(() => {});
  }
}
