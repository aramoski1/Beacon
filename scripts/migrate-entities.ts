import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

/**
 * Durable legal-entity model for ownership portfolios.
 * entities — one row per owner_name (LLC/person) per broker workspace
 * entity_properties — property membership
 * entity_contacts — CRM contacts linked to an entity (e.g. Sunbiz promote)
 */
const MIGRATION = `
-- ─── Entities ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  name_normalized  TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (kind IN ('entity', 'individual', 'unknown')),
  sunbiz_doc_number TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name_normalized)
);

CREATE INDEX IF NOT EXISTS entities_owner_id ON entities (owner_id);
CREATE INDEX IF NOT EXISTS entities_owner_name_norm ON entities (owner_id, name_normalized);

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entities' AND policyname = 'entities_owner_all'
  ) THEN
    CREATE POLICY entities_owner_all ON entities
      FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
END $$;

-- ─── Entity ↔ property ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_id, property_id)
);

CREATE INDEX IF NOT EXISTS entity_properties_owner ON entity_properties (owner_id);
CREATE INDEX IF NOT EXISTS entity_properties_entity ON entity_properties (entity_id);
CREATE INDEX IF NOT EXISTS entity_properties_property ON entity_properties (property_id);

ALTER TABLE entity_properties ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_properties' AND policyname = 'entity_properties_owner_all'
  ) THEN
    CREATE POLICY entity_properties_owner_all ON entity_properties
      FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
END $$;

-- ─── Entity ↔ contact (optional promote / relationship) ──────────────────────
CREATE TABLE IF NOT EXISTS entity_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_id, contact_id)
);

CREATE INDEX IF NOT EXISTS entity_contacts_owner ON entity_contacts (owner_id);
CREATE INDEX IF NOT EXISTS entity_contacts_entity ON entity_contacts (entity_id);
CREATE INDEX IF NOT EXISTS entity_contacts_contact ON entity_contacts (contact_id);

ALTER TABLE entity_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_contacts' AND policyname = 'entity_contacts_owner_all'
  ) THEN
    CREATE POLICY entity_contacts_owner_all ON entity_contacts
      FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
END $$;

-- Denormalized FK on properties for fast portfolio lookups
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS properties_entity_id ON properties (entity_id)
  WHERE entity_id IS NOT NULL;
`;

/** Mirror lib/owner-contacts.normalizeOwnerName in SQL. */
const NORM_SQL = `
  lower(
    regexp_replace(
      regexp_replace(trim(p.owner_name), '\\.', '', 'g'),
      '\\s+',
      ' ',
      'g'
    )
  )
`;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected to Supabase database.");

  console.log("\nRunning entities migration...");
  await client.query(MIGRATION);
  console.log("Tables + RLS ready.");

  console.log("\nBackfilling entities from distinct properties.owner_name...");
  const { rowCount: entityCount } = await client.query(`
    INSERT INTO entities (owner_id, name, name_normalized, kind)
    SELECT
      p.owner_id,
      trim(p.owner_name) AS name,
      ${NORM_SQL} AS name_normalized,
      CASE
        WHEN trim(p.owner_name) ~* '\\y(LLC|INC|CORP|LP|LLP|LLLP|PA|PL|PLLC|LTD|CO)\\y'
          THEN 'entity'
        ELSE 'individual'
      END AS kind
    FROM properties p
    WHERE p.owner_name IS NOT NULL
      AND trim(p.owner_name) <> ''
    ON CONFLICT (owner_id, name_normalized) DO NOTHING
  `);
  console.log(`  entities inserted (new): ${entityCount ?? 0}`);

  console.log("\nLinking entity_properties...");
  const { rowCount: linkCount } = await client.query(`
    INSERT INTO entity_properties (owner_id, entity_id, property_id)
    SELECT p.owner_id, e.id, p.id
    FROM properties p
    JOIN entities e
      ON e.owner_id = p.owner_id
     AND e.name_normalized = ${NORM_SQL}
    WHERE p.owner_name IS NOT NULL
      AND trim(p.owner_name) <> ''
    ON CONFLICT (entity_id, property_id) DO NOTHING
  `);
  console.log(`  entity_properties inserted (new): ${linkCount ?? 0}`);

  console.log("\nSetting properties.entity_id...");
  const { rowCount: propCount } = await client.query(`
    UPDATE properties p
    SET entity_id = e.id
    FROM entities e
    WHERE e.owner_id = p.owner_id
      AND p.owner_name IS NOT NULL
      AND trim(p.owner_name) <> ''
      AND e.name_normalized = ${NORM_SQL}
      AND (p.entity_id IS DISTINCT FROM e.id)
  `);
  console.log(`  properties.entity_id updated: ${propCount ?? 0}`);

  const tables = ["entities", "entity_properties", "entity_contacts"];
  for (const table of tables) {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    console.log(`\n✓ ${table} (${rows.length} columns)`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
