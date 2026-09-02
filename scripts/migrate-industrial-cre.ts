import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SQL = `
-- Industrial / flex listing fields (Prompt B)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS clear_height_ft numeric,
  ADD COLUMN IF NOT EXISTS dock_doors integer,
  ADD COLUMN IF NOT EXISTS drive_in_doors integer,
  ADD COLUMN IF NOT EXISTS power_amps integer,
  ADD COLUMN IF NOT EXISTS power_phase text,
  ADD COLUMN IF NOT EXISTS yard_acres numeric,
  ADD COLUMN IF NOT EXISTS column_spacing text,
  ADD COLUMN IF NOT EXISTS sprinkler_type text,
  ADD COLUMN IF NOT EXISTS availability_status text,
  ADD COLUMN IF NOT EXISTS asking_rent_psf numeric,
  ADD COLUMN IF NOT EXISTS nnn_cam_psf numeric,
  ADD COLUMN IF NOT EXISTS lease_structure text,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

-- Investor / 1031 buyer criteria
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS cap_rate_target numeric,
  ADD COLUMN IF NOT EXISTS preferred_markets text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_min_sf integer,
  ADD COLUMN IF NOT EXISTS preferred_max_sf integer,
  ADD COLUMN IF NOT EXISTS exchange_1031_deadline date,
  ADD COLUMN IF NOT EXISTS buyer_criteria_notes text;

-- Broker-entered rent comps (complements lease abstracts)
CREATE TABLE IF NOT EXISTS rent_comps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  address text,
  submarket text,
  property_type text,
  size_sqft numeric,
  rent_psf numeric,
  lease_structure text,
  comp_date date,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rent_comps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'rent_comps' AND policyname = 'rent_comps_owner_all'
  ) THEN
    CREATE POLICY rent_comps_owner_all ON rent_comps
      FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
  END IF;
END;
$$;
`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");
  await client.query(SQL);
  console.log("Industrial + buyer + rent_comps ready.");
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
