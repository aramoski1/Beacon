/**
 * Pilot auth: confirm existing unconfirmed users so they can sign in without
 * waiting on Supabase's unreliable built-in confirmation mailer.
 *
 * New signups are confirmed in-app via lib/auth-pilot-confirm.ts (UPDATE works;
 * CREATE TRIGGER on schema auth is denied on hosted Supabase).
 *
 * Dashboard (recommended companion):
 *   Authentication → Providers → Email → disable "Confirm email"
 *   Authentication → URL Configuration allow:
 *     http://localhost:3000/**
 *     http://localhost:3000/auth/callback
 */
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected.");

  const updated = await client.query<{ email: string }>(
    `update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now())
     where email_confirmed_at is null
       and email is not null
     returning email`
  );

  if (updated.rowCount === 0) {
    console.log("✓ No unconfirmed users — nothing to update.");
  } else {
    console.log(`✓ Confirmed ${updated.rowCount} user(s):`);
    for (const r of updated.rows) console.log(`  - ${r.email}`);
  }

  const { rows } = await client.query<{ email: string; confirmed: boolean }>(
    `select email, email_confirmed_at is not null as confirmed
     from auth.users
     order by created_at desc
     limit 20`
  );
  console.log("\nCurrent auth.users:");
  for (const r of rows) {
    console.log(`  - ${r.email}: ${r.confirmed ? "confirmed" : "UNCONFIRMED"}`);
  }

  console.log(
    "\nSupabase Dashboard checklist:\n" +
      "  1. Auth → Providers → Email → Confirm email = OFF (pilot)\n" +
      "  2. Auth → URL Configuration allowlist includes:\n" +
      "       http://localhost:3000/**\n" +
      "       http://localhost:3000/auth/callback\n" +
      "  New signups are also auto-confirmed by the app when DATABASE_URL is set.\n"
  );

  await client.end();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
