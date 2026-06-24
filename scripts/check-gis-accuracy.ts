// GIS accuracy check — verifies that searchByAddressGIS returns the correct
// parcel as its top result for a set of known Miami-Dade address/folio pairs.
//
// HOW TO FILL IN expectedFolio:
//   1. Visit https://www.miamidade.gov/Apps/PA/propertysearch/#/
//   2. Search the address, copy the 13-digit folio from the result
//      (the "Folio Number" with dashes removed, e.g. "0131250780010")
//   3. Paste it as the expectedFolio string below.
//
// Results where expectedFolio is null are "discovery mode" — the script shows
// what the GIS returns so you can verify and fill in the folio.
//
// Usage:  npx tsx --env-file=.env.local scripts/check-gis-accuracy.ts

import { searchByAddressGIS, type GISParcel } from "../lib/mdpa";

// ─── Test cases ───────────────────────────────────────────────────────────────
// Real Miami-Dade commercial properties chosen for variety across submarkets.
// Verify each expectedFolio on the MDPA site before treating results as ground truth.

type TestCase = {
  label: string;
  address: string;
  expectedFolio: string | null; // 13 digits, no dashes — null = discovery mode
};

const TEST_CASES: TestCase[] = [
  // Downtown / Brickell ──────────────────────────────────────────────────────
  {
    label: "SE Financial Center",
    address: "200 S Biscayne Blvd, Miami",
    expectedFolio: null, // verify at MDPA
  },
  {
    label: "1221 Brickell (office tower)",
    address: "1221 Brickell Ave, Miami",
    expectedFolio: null,
  },
  {
    label: "701 Brickell (Brickell World Plaza)",
    address: "701 Brickell Ave, Miami",
    expectedFolio: null,
  },
  // Wynwood / Midtown ────────────────────────────────────────────────────────
  {
    label: "Wynwood — 3401 N Miami Ave (used as lib/mdpa.ts example)",
    address: "3401 N Miami Ave, Miami",
    expectedFolio: null,
  },
  // Airport / Doral industrial ───────────────────────────────────────────────
  {
    label: "Doral industrial (NW 36 St corridor)",
    address: "7900 NW 36 St, Miami",
    expectedFolio: null,
  },
  // Coral Gables ─────────────────────────────────────────────────────────────
  {
    label: "Alhambra Plaza (Coral Gables CBD)",
    address: "1 Alhambra Plaza, Coral Gables",
    expectedFolio: null,
  },
  {
    label: "Ponce de Leon office (Coral Gables)",
    address: "355 Alhambra Cir, Coral Gables",
    expectedFolio: null,
  },
  // North Miami ──────────────────────────────────────────────────────────────
  {
    label: "Aventura Mall anchor parcel",
    address: "19501 Biscayne Blvd, Aventura",
    expectedFolio: null,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HR  = "─".repeat(64);
const HR2 = "·".repeat(64);

function folioMatch(parcels: GISParcel[], expected: string): "TOP" | "FOUND" | "MISS" {
  if (parcels.length === 0) return "MISS";
  if (parcels[0].folio === expected) return "TOP";
  if (parcels.some((p) => p.folio === expected)) return "FOUND";
  return "MISS";
}

function statusBadge(status: "TOP" | "FOUND" | "MISS" | "DISCOVERY"): string {
  return {
    TOP:       "✓  TOP MATCH",
    FOUND:     "~  FOUND (not top)",
    MISS:      "✗  MISS",
    DISCOVERY: "?  discovery",
  }[status];
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${HR}`);
  console.log("  Beacon — GIS accuracy check");
  console.log(`  ${TEST_CASES.length} test cases\n`);

  let topCount    = 0;
  let foundCount  = 0;
  let missCount   = 0;
  let discCount   = 0;
  let errorCount  = 0;
  const evaluated = 0; // cases with expectedFolio set

  for (const tc of TEST_CASES) {
    console.log(HR2);
    console.log(`  ${tc.label}`);
    console.log(`  Address: ${tc.address}`);

    let parcels: GISParcel[] = [];
    let errMsg: string | null = null;

    try {
      parcels = await searchByAddressGIS(tc.address);
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
      errorCount++;
    }

    if (errMsg) {
      console.log(`  ERROR: ${errMsg}`);
      console.log();
      continue;
    }

    if (parcels.length === 0) {
      console.log("  GIS returned 0 results.");
      if (tc.expectedFolio) {
        missCount++;
        console.log(`  Status: ${statusBadge("MISS")}`);
      } else {
        discCount++;
        console.log(`  Status: ${statusBadge("DISCOVERY")}  (fill in expectedFolio to score)`);
      }
      console.log();
      continue;
    }

    // Print GIS results table
    console.log(`  GIS returned ${parcels.length} result(s):`);
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      const marker = tc.expectedFolio && p.folio === tc.expectedFolio ? " ← expected" : "";
      console.log(`    [${i + 1}] folio=${p.folio}  strap=${p.strap}  address="${p.address}"${marker}`);
    }

    if (tc.expectedFolio) {
      const result = folioMatch(parcels, tc.expectedFolio);
      if (result === "TOP")   topCount++;
      if (result === "FOUND") foundCount++;
      if (result === "MISS")  missCount++;
      console.log(`  Expected folio: ${tc.expectedFolio}`);
      console.log(`  Status: ${statusBadge(result)}`);
    } else {
      discCount++;
      console.log(`  Status: ${statusBadge("DISCOVERY")}  (fill in expectedFolio to score)`);
    }

    console.log();
    // Small delay between requests so we don't hammer the GIS API
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const scored = topCount + foundCount + missCount;
  console.log(HR);
  console.log("  Summary");
  console.log(HR);
  console.log(`  Scored (expectedFolio set):`);
  console.log(`    ✓  Top match:           ${topCount}`);
  console.log(`    ~  Found (not top):     ${foundCount}`);
  console.log(`    ✗  Miss:                ${missCount}`);
  if (errorCount > 0)
    console.log(`    !  Errors:              ${errorCount}`);
  if (scored > 0) {
    const pct = Math.round((topCount / scored) * 100);
    console.log(`    Top-1 accuracy:        ${pct}%  (${topCount}/${scored})`);
  }
  if (discCount > 0) {
    console.log();
    console.log(`  Discovery mode (no expectedFolio): ${discCount}`);
    console.log("  → Look up each address on https://www.miamidade.gov/Apps/PA/propertysearch/");
    console.log("    then paste the 13-digit folio into expectedFolio above and re-run.");
  }
  console.log(`${HR}\n`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
