// Seed script — inserts N test properties for a single user account.
//
// Usage:  npm run seed:test
// Env:    DATABASE_URL (from .env.local) — required
//         SEED_COUNT=2000               — how many to insert (default 2000)
//         SEED_OWNER_ID=<uuid>          — target user; defaults to first user in auth.users
//
// To clean up:  DELETE FROM properties WHERE source = 'seed:test';

import { Client } from "pg";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set — add it to .env.local");
  process.exit(1);
}

// ─── Lookup tables ────────────────────────────────────────────────────────────

const PROPERTY_TYPES = [
  "industrial", "industrial", "industrial",   // weight toward industrial
  "office", "office",
  "retail", "retail",
  "multifamily",
  "land",
  "mixed-use",
  "other",
];

const OWNERSHIP_TYPES = [
  "private", "private", "private",
  "institutional", "institutional",
  "owner-occupant",
  "REIT",
  "unknown",
];

const CITIES = [
  "Miami", "Miami", "Miami",
  "Doral", "Doral",
  "Hialeah", "Hialeah",
  "Miami Gardens",
  "Homestead",
  "Aventura",
  "Coral Gables",
  "Kendall",
  "Opa-locka",
  "Medley",
  "Miami Lakes",
];

const SIZE_CATEGORIES = [
  "Small", "Small",
  "Medium", "Medium", "Medium",
  "Large", "Large",
  "Extra Large",
];

const GEO_CATEGORIES = [
  "Miami-Dade",
  "Doral",
  "Northwest",
  "Southwest",
  "Brickell",
  "Downtown",
  "Airport Area",
  "Kendall",
  "North Dade",
  "South Dade",
];

const STREET_NAMES = [
  "NW 36th St", "SW 8th St", "Brickell Ave", "Le Jeune Rd", "NW 87th Ave",
  "Bird Rd", "Flagler St", "Coral Way", "NW 107th Ave", "SW 40th St",
  "NW 79th St", "NW 119th St", "SW 137th Ave", "NW 25th St", "NW 58th St",
  "NW 74th St", "SW 24th St", "NW 12th Ave", "NW 36th Ave", "SW 72nd Ave",
  "NW 97th Ave", "NW 106th St", "SW 107th Ave", "NW 91st St", "W 33rd St",
  "NW 72nd Ave", "NW 40th Ave", "NW 108th St", "NW 90th St", "NW 89th Ave",
];

const OWNER_FIRST = [
  "SMITH", "JONES", "WILLIAMS", "BROWN", "GARCIA", "RODRIGUEZ",
  "MARTINEZ", "HERNANDEZ", "LOPEZ", "GONZALEZ", "PEREZ", "SANCHEZ",
  "RAMIREZ", "TORRES", "FLORES", "RIVERA", "GOMEZ", "DIAZ", "REYES", "CRUZ",
];

const OWNER_SUFFIXES = [
  "LLC", "LLC", "LLC",
  "HOLDINGS LLC", "HOLDINGS LLC",
  "PROPERTIES LLC",
  "REAL ESTATE LLC",
  "INVESTMENTS LLC",
  "CAPITAL LLC",
  "GROUP LLC",
  "ENTERPRISES INC",
];

const ASSET_DESCRIPTORS: Record<string, string[]> = {
  industrial:   ["Warehouse", "Distribution Center", "Flex Warehouse", "Manufacturing Facility", "Cold Storage"],
  office:       ["Office Building", "Medical Office", "Class A Office", "Office Park"],
  retail:       ["Strip Center", "Retail Storefront", "Shopping Center", "Gas Station with C-Store"],
  multifamily:  ["Apartment Complex", "Garden Apartments", "Walk-Up Apartments"],
  land:         ["Vacant Land", "Development Site", "Corner Lot", "Industrial Land"],
  residential:  ["Single Family", "Duplex", "Triplex"],
  "mixed-use":  ["Mixed-Use Building", "Live-Work Loft"],
  other:        ["Special Purpose", "Church", "Auto Dealership"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sizeSqftFor(cat: string): number {
  if (cat === "Small")       return randInt(1_000, 9_999);
  if (cat === "Medium")      return randInt(10_000, 49_999);
  if (cat === "Large")       return randInt(50_000, 199_999);
  return                            randInt(200_000, 999_999);
}

function randomDate(yearsBack: number): string {
  const ms = Date.now() - randInt(0, yearsBack * 365 * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

// ─── Row factory ─────────────────────────────────────────────────────────────

function makeProperty(ownerId: string, prospectBase: number, index: number) {
  const propertyType = pick(PROPERTY_TYPES);
  const sizeCategory = pick(SIZE_CATEGORIES);
  const city         = pick(CITIES);
  const ownerName    = `${pick(OWNER_FIRST)} ${pick(OWNER_SUFFIXES)}`;
  const descriptors  = ASSET_DESCRIPTORS[propertyType] ?? ["Property"];
  const assetDesc    = `${pick(descriptors)} — ${city}`;
  const houseNum     = randInt(100, 19_999);
  const street       = pick(STREET_NAMES);
  // Stagger created_at so ORDER BY created_at DESC gives predictable pages
  const createdAt    = new Date(Date.now() - index * 60_000).toISOString();

  return {
    id:               randomUUID(),
    owner_id:         ownerId,
    address:          `${houseNum} ${street}`,
    city,
    owner_name:       ownerName,
    ownership_type:   pick(OWNERSHIP_TYPES),
    property_type:    propertyType,
    size_sqft:        sizeSqftFor(sizeCategory),
    size_category:    sizeCategory,
    geographic_category: pick(GEO_CATEGORIES),
    asset_description:   assetDesc,
    last_sale_date:   Math.random() > 0.3 ? randomDate(20) : null,
    last_sale_price:  Math.random() > 0.3 ? randInt(200_000, 12_000_000) : null,
    source:           "seed:test",
    prospect_number:  prospectBase + index,
    created_at:       createdAt,
    updated_at:       createdAt,
  };
}

// ─── Batch insert ─────────────────────────────────────────────────────────────

const COLS = [
  "id", "owner_id", "address", "city", "owner_name", "ownership_type",
  "property_type", "size_sqft", "size_category", "geographic_category",
  "asset_description", "last_sale_date", "last_sale_price",
  "source", "prospect_number", "created_at", "updated_at",
] as const;

type PropRow = Record<typeof COLS[number], unknown>;

async function insertBatch(db: Client, batch: PropRow[]) {
  const numCols = COLS.length;
  const placeholders = batch
    .map((_, ri) => `(${COLS.map((_, ci) => `$${ri * numCols + ci + 1}`).join(",")})`)
    .join(",");
  const values = batch.flatMap((row) => COLS.map((c) => row[c]));
  await db.query(
    `INSERT INTO properties (${COLS.join(",")}) VALUES ${placeholders}
     ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  // Resolve owner
  let ownerId = process.env.SEED_OWNER_ID ?? "";
  if (!ownerId) {
    const { rows } = await db.query<{ id: string; email: string }>(
      "SELECT id, email FROM auth.users ORDER BY created_at LIMIT 1"
    );
    if (rows.length === 0) {
      console.error("No users found — sign up first, then re-run.");
      await db.end();
      process.exit(1);
    }
    ownerId = rows[0].id;
    console.log(`Seeding for: ${rows[0].email} (${ownerId})`);
  }

  // Find current max prospect_number so we don't collide
  const { rows: maxRows } = await db.query<{ max: number | null }>(
    "SELECT MAX(prospect_number) AS max FROM properties WHERE owner_id = $1",
    [ownerId],
  );
  const prospectBase = (maxRows[0]?.max ?? 0) + 1;

  const COUNT      = parseInt(process.env.SEED_COUNT ?? "2000", 10);
  const BATCH_SIZE = 100;

  console.log(`\nGenerating ${COUNT} test properties (prospect #${prospectBase}–${prospectBase + COUNT - 1})…`);

  let inserted = 0;
  for (let i = 0; i < COUNT; i += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, COUNT - i);
    const batch: PropRow[] = Array.from({ length: batchCount }, (_, j) =>
      makeProperty(ownerId, prospectBase, i + j) as PropRow
    );
    await insertBatch(db, batch);
    inserted += batchCount;
    process.stdout.write(`\r  ${inserted}/${COUNT} inserted…`);
  }

  console.log(`\n\nDone — ${COUNT} properties created.`);
  console.log(`Clean up later:  DELETE FROM properties WHERE source = 'seed:test';\n`);

  await db.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
