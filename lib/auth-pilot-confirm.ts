/**
 * Pilot-only: confirm a just-created auth user via direct Postgres.
 * Hosted Supabase blocks CREATE on schema auth, so we can't install a trigger;
 * UPDATE on auth.users works as the postgres role (DATABASE_URL).
 *
 * Requires DATABASE_URL. No-op if unset (e.g. misconfigured deploy).
 * Import only from server actions / server modules.
 */
import { Client } from "pg";

export async function pilotConfirmUserEmail(email: string): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !email.trim()) return false;

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const { rowCount } = await client.query(
      `update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now())
       where lower(email) = lower($1)`,
      [email.trim()]
    );
    return (rowCount ?? 0) > 0;
  } catch (err) {
    console.error("[pilotConfirmUserEmail]", err);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
