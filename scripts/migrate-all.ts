// Runs every migration script in dependency order.
// Each script is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),
// so re-running is always safe.
//
// Usage:  npm run migrate
// Requires: DATABASE_URL in .env.local

import { spawnSync } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const SCRIPTS: { file: string; description: string }[] = [
  {
    file: "migrate.ts",
    description: "Base tables — properties, contacts, lease_abstracts + RLS",
  },
  {
    file: "migrate-contacts.ts",
    description: "Contacts — size_category, geographic_category, ownership_type columns",
  },
  {
    file: "migrate-custom-fields.ts",
    description: "Custom fields — field_definitions table + custom_fields JSONB on all entities",
  },
  {
    file: "setup-storage.ts",
    description: "Storage — leases bucket + RLS policies",
  },
  {
    file: "migrate-ingestion-errors.ts",
    description: "Ingestion errors — error log table + RLS",
  },
  {
    file: "migrate-new-fields.ts",
    description: "New fields — prospect_number, land_sqft, asset_description on properties; mailing_address on contacts",
  },
  {
    file: "migrate-owner-mailing.ts",
    description: "Properties — owner_mailing_address column (from MDPA owner record)",
  },
  {
    file: "migrate-activities.ts",
    description: "Activities — activities table with RLS (contact + property touch-point log)",
  },
];

const hr = "─".repeat(60);

console.log(`\nBeacon — running ${SCRIPTS.length} migrations\n`);

for (let i = 0; i < SCRIPTS.length; i++) {
  const { file, description } = SCRIPTS[i];

  console.log(hr);
  console.log(`[${i + 1}/${SCRIPTS.length}] ${file}`);
  console.log(`        ${description}`);
  console.log(hr);

  const result = spawnSync("tsx", [join(__dirname, file)], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });

  if (result.error) {
    console.error(`\nFailed to spawn: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n✗ ${file} exited with code ${result.status}. Stopping.`);
    process.exit(result.status ?? 1);
  }

  console.log(`\n✓ Done\n`);
}

console.log(hr);
console.log(`✓ All ${SCRIPTS.length} migrations complete.`);
console.log(hr + "\n");
