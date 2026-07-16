// GIS accuracy harness — pulls MDPA-sourced properties from the Supabase DB
// (any row where source_url starts with 'mdpa:' carries a ground-truth folio),
// re-runs each address through searchByAddressGIS, and reports whether the
// fresh lookup returns the same folio that is stored on the property row.
//
// Measures only — does not touch the database or change any lookup logic.
//
// Usage:  npm run check:gis
// Env:    DATABASE_URL (from .env.local)
// Opt:    GIS_LIMIT=50  (default 200; set lower for a quick spot-check)

import { Client } from "pg";
import {
  searchByAddressGIS,
  parseAddressForGIS,
  folioToStrap,
  type GISParcel,
} from "../lib/mdpa";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set — add it to .env.local");
  process.exit(1);
}

const MAX_ROWS = parseInt(process.env.GIS_LIMIT ?? "200", 10);
const DELAY_MS = 350; // polite pause between GIS requests

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultTag = "match" | "mismatch" | "not_found" | "parse_error" | "api_error";

type Row = {
  id: string;
  address: string;
  owner_name: string | null;
  source_url: string; // "mdpa:XX-XXXX-XXX-XXXX"
};

type Result = {
  row: Row;
  storedStrap: string;  // dashed  "01-4137-065-0001"
  storedFolio: string;  // raw     "0141370650001"
  tag: ResultTag;
  parcels: GISParcel[];
  errorMessage?: string;
  foundAtRank?: number; // 1-based position of storedFolio if not top-1
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HR  = "─".repeat(70);
const HR2 = "·".repeat(70);

const TAG_LABEL: Record<ResultTag, string> = {
  match:       "✓  match",
  mismatch:    "✗  mismatch",
  not_found:   "—  not found (GIS returned 0 results)",
  parse_error: "⚠  unparseable address",
  api_error:   "!  API error",
};

function strapFromSourceUrl(sourceUrl: string): string {
  return sourceUrl.replace("mdpa:", ""); // "01-4137-065-0001"
}

function folioFromStrap(strap: string): string {
  return strap.replace(/-/g, "").padStart(13, "0"); // "0141370650001"
}

async function checkOne(row: Row): Promise<Result> {
  const storedStrap = strapFromSourceUrl(row.source_url);
  const storedFolio = folioFromStrap(storedStrap);
  const base = { row, storedStrap, storedFolio, parcels: [] as GISParcel[] };

  if (!parseAddressForGIS(row.address)) {
    return { ...base, tag: "parse_error" };
  }

  let parcels: GISParcel[];
  try {
    parcels = await searchByAddressGIS(row.address);
  } catch (e) {
    return {
      ...base,
      tag: "api_error",
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }

  if (parcels.length === 0) {
    return { ...base, tag: "not_found" };
  }

  if (parcels[0].folio === storedFolio) {
    return { ...base, tag: "match", parcels };
  }

  const rank = parcels.findIndex((p) => p.folio === storedFolio);
  return {
    ...base,
    tag: "mismatch",
    parcels,
    foundAtRank: rank === -1 ? undefined : rank + 1,
  };
}

function ownerTag(name: string | null): string {
  return name ? `  (${name})` : "";
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const { rows } = await db.query<Row>(
    `SELECT id, address, owner_name, source_url
     FROM properties
     WHERE source_url LIKE 'mdpa:%'
       AND address IS NOT NULL
       AND address <> ''
     ORDER BY created_at DESC
     LIMIT $1`,
    [MAX_ROWS]
  );

  await db.end();

  if (rows.length === 0) {
    console.log("\nNo MDPA-sourced properties found in the database.");
    console.log("Import properties via the tax roll ingestion flow first.\n");
    process.exit(0);
  }

  console.log(`\n${HR}`);
  console.log("  Beacon — GIS accuracy harness");
  console.log(`  Source: live Supabase DB · ${rows.length} MDPA-sourced propert${rows.length === 1 ? "y" : "ies"}`);
  if (rows.length === MAX_ROWS) {
    console.log(`  (capped at ${MAX_ROWS} — set GIS_LIMIT=N to change)`);
  }
  console.log(HR + "\n");

  const results: Result[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const n = `[${i + 1}/${rows.length}]`;

    console.log(`  ${n} ${row.address}`);

    const result = await checkOne(row);
    results.push(result);

    switch (result.tag) {
      case "parse_error":
        console.log(`       ${TAG_LABEL.parse_error}`);
        break;

      case "api_error":
        console.log(`       ${TAG_LABEL.api_error}: ${result.errorMessage}`);
        break;

      case "not_found":
        console.log(`       stored : ${result.storedStrap}${ownerTag(row.owner_name)}`);
        console.log(`       ${TAG_LABEL.not_found}`);
        break;

      case "match": {
        const top = result.parcels[0];
        console.log(`       stored : ${result.storedStrap}${ownerTag(row.owner_name)}`);
        console.log(`       GIS[1] : ${folioToStrap(top.folio)}  "${top.address}"`);
        console.log(`       ${TAG_LABEL.match}`);
        break;
      }

      case "mismatch": {
        const top = result.parcels[0];
        console.log(`       stored : ${result.storedStrap}${ownerTag(row.owner_name)}`);
        console.log(`       GIS[1] : ${folioToStrap(top.folio)}  "${top.address}"`);
        if (result.foundAtRank !== undefined) {
          console.log(`               stored folio appears at rank ${result.foundAtRank}`);
        }
        console.log(`       ${TAG_LABEL.mismatch}`);
        break;
      }
    }

    console.log();

    if (i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  const c = {
    match:       results.filter((r) => r.tag === "match").length,
    mismatch:    results.filter((r) => r.tag === "mismatch").length,
    not_found:   results.filter((r) => r.tag === "not_found").length,
    parse_error: results.filter((r) => r.tag === "parse_error").length,
    api_error:   results.filter((r) => r.tag === "api_error").length,
  };

  const scored    = c.match + c.mismatch + c.not_found;
  const matchPct  = scored > 0 ? Math.round((c.match / scored) * 100) : 0;

  console.log(HR);
  console.log("  Summary");
  console.log(HR);
  console.log(`  Tested           : ${rows.length}`);
  console.log(`  ✓  Match         : ${c.match}`);
  console.log(`  ✗  Mismatch      : ${c.mismatch}`);
  console.log(`  —  Not found     : ${c.not_found}`);
  if (c.parse_error) console.log(`  ⚠  Unparseable   : ${c.parse_error}`);
  if (c.api_error)   console.log(`  !  API errors    : ${c.api_error}`);
  console.log();
  if (scored > 0) {
    console.log(`  Top-1 match rate : ${matchPct}%  (${c.match}/${scored} scored)`);
  }

  // ── Mismatch detail ────────────────────────────────────────────────────────

  const mismatches = results.filter((r) => r.tag === "mismatch");
  if (mismatches.length > 0) {
    console.log();
    console.log(HR);
    console.log("  Mismatches — what GIS returned vs. what is stored");
    console.log(HR);

    for (const r of mismatches) {
      console.log(`\n  ┌─ ${r.row.address}${ownerTag(r.row.owner_name)}`);
      console.log(`  │  stored folio : ${r.storedStrap}`);
      for (let i = 0; i < r.parcels.length; i++) {
        const p = r.parcels[i];
        const marker = p.folio === r.storedFolio ? "  ← STORED FOLIO HERE" : "";
        console.log(`  │  GIS [${i + 1}]       : ${folioToStrap(p.folio)}  "${p.address}"${marker}`);
      }
      if (r.foundAtRank !== undefined) {
        console.log(`  │  → stored folio found at rank ${r.foundAtRank} (not top-1)`);
      } else {
        console.log(`  │  → stored folio absent from all GIS results`);
      }
      console.log("  └─");
    }
    console.log();
  }

  // ── Not-found summary ──────────────────────────────────────────────────────

  const notFound = results.filter((r) => r.tag === "not_found");
  if (notFound.length > 0) {
    console.log();
    console.log(HR);
    console.log("  Not found — GIS returned 0 results for these addresses");
    console.log(HR);
    for (const r of notFound) {
      console.log(`  •  ${r.row.address}  (stored: ${r.storedStrap})`);
    }
    console.log();
  }

  console.log(`\n${HR}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
