import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Team/brokerage multi-tenancy — Phase 0 (foundations, dark).
 * See Beacon_Team_Multitenancy_Plan.md §2, §5.1, §7.
 *
 * firms           — a brokerage/team. Every user gets a personal one at signup.
 * firm_members    — membership + role. At most one ACTIVE row per user (partial
 *                   unique index) — v1 supports exactly one active firm per user.
 * firm_invitations — pending link-based invites (no service-role key needed —
 *                    redemption is a plain RLS-permitted INSERT, added in
 *                    Phase 5's migration once the invite flow ships).
 * is_firm_teammate() — the single helper every team-scoped RLS policy calls,
 *                       rather than each policy re-deriving the join itself.
 *
 * Nothing here touches any existing table's RLS. Purely additive.
 */
const MIGRATION = `
-- ─── Firms ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE firms ENABLE ROW LEVEL SECURITY;

-- ─── Firm membership ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firm_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  invited_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_id, user_id)
);

CREATE INDEX IF NOT EXISTS firm_members_firm_id ON firm_members (firm_id);
CREATE INDEX IF NOT EXISTS firm_members_user_id ON firm_members (user_id);

-- At most one ACTIVE firm per user (v1 constraint — plan §2.2).
CREATE UNIQUE INDEX IF NOT EXISTS firm_members_one_active_per_user
  ON firm_members (user_id) WHERE status = 'active';

ALTER TABLE firm_members ENABLE ROW LEVEL SECURITY;

-- ─── Firm invitations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firm_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token       TEXT NOT NULL UNIQUE,
  invited_by  UUID NOT NULL REFERENCES auth.users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS firm_invitations_firm_id ON firm_invitations (firm_id);
CREATE INDEX IF NOT EXISTS firm_invitations_email ON firm_invitations (lower(email));

ALTER TABLE firm_invitations ENABLE ROW LEVEL SECURITY;

-- ─── RLS: firms ─────────────────────────────────────────────────────────────
-- Visible to active members of the firm. Insert/update reserved for the
-- creator at insert time; ongoing rename is done via a dedicated policy
-- scoped to the firm's owner (added below once firm_members exists to check against).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firms' AND policyname = 'firms_member_select'
  ) THEN
    CREATE POLICY firms_member_select ON firms
      FOR SELECT USING (
        id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND status = 'active')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firms' AND policyname = 'firms_creator_insert'
  ) THEN
    CREATE POLICY firms_creator_insert ON firms
      FOR INSERT WITH CHECK (created_by = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firms' AND policyname = 'firms_owner_update'
  ) THEN
    CREATE POLICY firms_owner_update ON firms
      FOR UPDATE USING (
        id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND status = 'active' AND role = 'owner')
      ) WITH CHECK (
        id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND status = 'active' AND role = 'owner')
      );
  END IF;
END $$;

-- ─── RLS: firm_members ──────────────────────────────────────────────────────
-- Deliberately self-referencing (plan §5.1): a member needs to see their whole
-- firm's roster, not just their own row. This is the one policy in the whole
-- feature that queries its own table from within its own USING clause — kept
-- to this single, narrow, well-tested policy rather than spread across many.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firm_members' AND policyname = 'firm_members_roster_select'
  ) THEN
    CREATE POLICY firm_members_roster_select ON firm_members
      FOR SELECT USING (
        firm_id IN (SELECT firm_id FROM firm_members me WHERE me.user_id = auth.uid() AND me.status = 'active')
      );
  END IF;
END $$;

-- Self-insert for personal-firm bootstrap at signup. Invitation-redemption
-- insert (join an existing firm via a valid token) is a separate policy
-- added in Phase 5's migration, once the invite flow ships.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firm_members' AND policyname = 'firm_members_self_bootstrap_insert'
  ) THEN
    CREATE POLICY firm_members_self_bootstrap_insert ON firm_members
      FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND role = 'owner'
        AND firm_id IN (SELECT id FROM firms WHERE created_by = auth.uid())
      );
  END IF;
END $$;

-- Admin/owner can manage membership within their own firm (role changes,
-- removal via status flip). A member can also update their own row only to
-- flip their own status to 'removed' (self-leave) — enforced by the WITH CHECK.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firm_members' AND policyname = 'firm_members_admin_manage'
  ) THEN
    CREATE POLICY firm_members_admin_manage ON firm_members
      FOR UPDATE USING (
        user_id = auth.uid()
        OR firm_id IN (
          SELECT firm_id FROM firm_members me
          WHERE me.user_id = auth.uid() AND me.status = 'active' AND me.role IN ('owner', 'admin')
        )
      ) WITH CHECK (
        user_id = auth.uid()
        OR firm_id IN (
          SELECT firm_id FROM firm_members me
          WHERE me.user_id = auth.uid() AND me.status = 'active' AND me.role IN ('owner', 'admin')
        )
      );
  END IF;
END $$;

-- ─── RLS: firm_invitations ──────────────────────────────────────────────────
-- Only the firm's admin/owner can see or manage its pending invites.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firm_invitations' AND policyname = 'firm_invitations_admin_all'
  ) THEN
    CREATE POLICY firm_invitations_admin_all ON firm_invitations
      FOR ALL USING (
        firm_id IN (
          SELECT firm_id FROM firm_members
          WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')
        )
      ) WITH CHECK (
        firm_id IN (
          SELECT firm_id FROM firm_members
          WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')
        )
      );
  END IF;
END $$;

-- An invited (not-yet-member) user needs to be able to read their OWN pending
-- invitation by matching their authenticated email, to render the /join/[token]
-- page before they've been added to firm_members at all.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'firm_invitations' AND policyname = 'firm_invitations_invitee_select'
  ) THEN
    CREATE POLICY firm_invitations_invitee_select ON firm_invitations
      FOR SELECT USING (
        lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      );
  END IF;
END $$;

-- ─── is_firm_teammate() ─────────────────────────────────────────────────────
-- The single helper every team-scoped RLS policy on the existing 16 tables
-- calls (plan §5 Principle 2). SECURITY DEFINER so it can look at
-- firm_members without tripping the self-referencing-policy trap in every
-- OTHER table's policy — this function's only job is this one boolean check,
-- it exposes no data of its own.
CREATE OR REPLACE FUNCTION is_firm_teammate(target_owner_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM firm_members me
    JOIN firm_members them
      ON me.firm_id = them.firm_id
     AND them.status = 'active'
    WHERE me.user_id = auth.uid()
      AND me.status = 'active'
      AND them.user_id = target_owner_id
  );
$fn$;
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning firms/firm_members/firm_invitations migration...");
  await client.query(MIGRATION);
  console.log("Tables + RLS + is_firm_teammate() ready.");

  console.log("\nBackfilling one personal firm per existing user...");
  const { rowCount: firmCount } = await client.query(`
    INSERT INTO firms (id, name, created_by)
    SELECT gen_random_uuid(),
           COALESCE(NULLIF(trim(us.display_name), ''), 'My') || '''s team',
           u.id
    FROM auth.users u
    LEFT JOIN user_settings us ON us.owner_id = u.id
    WHERE NOT EXISTS (SELECT 1 FROM firm_members fm WHERE fm.user_id = u.id)
  `);
  console.log(`  firms inserted (new): ${firmCount ?? 0}`);

  console.log("\nBackfilling firm_members (each new firm's creator as owner)...");
  const { rowCount: memberCount } = await client.query(`
    INSERT INTO firm_members (firm_id, user_id, role, status)
    SELECT f.id, f.created_by, 'owner', 'active'
    FROM firms f
    WHERE NOT EXISTS (
      SELECT 1 FROM firm_members fm WHERE fm.firm_id = f.id AND fm.user_id = f.created_by
    )
  `);
  console.log(`  firm_members inserted (new): ${memberCount ?? 0}`);

  const tables = ["firms", "firm_members", "firm_invitations"];
  for (const table of tables) {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    console.log(`\n✓ ${table} (${rows.length} columns)`);
  }

  const { rows: fnRows } = await client.query(
    `SELECT proname FROM pg_proc WHERE proname = 'is_firm_teammate'`
  );
  console.log(`\n✓ is_firm_teammate() ${fnRows.length > 0 ? "present" : "MISSING"}`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
