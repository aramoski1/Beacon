// GIS accuracy harness.
//
// Modes:
//   1) CSV (preferred for labeled eval):
//        npm run check:gis -- path/to/labeled.csv
//      CSV columns (header required): address, expected_owner, expected_folio
//      expected_folio may be dashed (01-3125-078-0010) or 13-digit.
//
//   2) Live DB (regression against already-imported MDPA properties):
//        npm run check:gis
//      Uses properties where source_url LIKE 'mdpa:%' as ground truth.
//      Opt: GIS_LIMIT=50 (default 200)
//
// Env: DATABASE_URL only required for DB mode (.env.local via npm script).
// Measures only — does not write to the database.

import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";
import {
  searchByAddressGIS,
  parseAddressForGIS,
  folioToStrap,
  type GISParcel,
} from "../lib/mdpa";

const DELAY_MS = 350;

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultTag = "match" | "mismatch" | "not_found" | "parse_error" | "api_error";

type LabeledRow = {
  address: string;
  expectedOwner: string | null;
  expectedFolio: string; // normalized 13-digit
  expectedStrap: string; // dashed display
};

type Result = {
  row: LabeledRow;
  tag: ResultTag;
  parcels: GISParcel[];
  errorMessage?: string;
  foundAtRank?: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HR = "─".repeat(70);

const TAG_LABEL: Record<ResultTag, string> = {
  match: "✓  match",
  mismatch: "✗  mismatch",
  not_found: "—  not found (GIS returned 0 results)",
  parse_error: "⚠  unparseable address",
  api_error: "!  API error",
};

/** Normalize folio to 13-digit string (accepts dashed or undashed). */
export function normalizeFolio(raw: string): string {
  return raw.replace(/-/g, "").replace(/\D/g, "").padStart(13, "0");
}

function ownerTag(name: string | null): string {
  return name ? `  (${name})` : "";
}

/** Minimal CSV parser: header row + comma-separated values, supports quoted fields. */
export function parseLabeledCsv(text: string): LabeledRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const addrIdx = header.indexOf("address");
  const ownerIdx = header.indexOf("expected_owner");
  const folioIdx = header.indexOf("expected_folio");
  if (addrIdx === -1 || folioIdx === -1) {
    throw new Error(
      "CSV header must include 'address' and 'expected_folio' (optional: expected_owner)."
    );
  }

  const rows: LabeledRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const address = (cols[addrIdx] ?? "").trim();
    const folioRaw = (cols[folioIdx] ?? "").trim();
    if (!address || !folioRaw) continue;
    const expectedFolio = normalizeFolio(folioRaw);
    rows.push({
      address,
      expectedOwner: ownerIdx >= 0 ? (cols[ownerIdx] ?? "").trim() || null : null,
      expectedFolio,
      expectedStrap: folioToStrap(expectedFolio),
    });
  }
  if (rows.length === 0) {
    throw new Error("CSV contained no usable data rows.");
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function checkOne(row: LabeledRow): Promise<Result> {
  const base = { row, parcels: [] as GISParcel[] };

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

  if (parcels[0].folio === row.expectedFolio) {
    return { ...base, tag: "match", parcels };
  }

  const rank = parcels.findIndex((p) => p.folio === row.expectedFolio);
  return {
    ...base,
    tag: "mismatch",
    parcels,
    foundAtRank: rank === -1 ? undefined : rank + 1,
  };
}

async function loadFromCsv(csvPath: string): Promise<LabeledRow[]> {
  const abs = resolve(csvPath);
  const text = readFileSync(abs, "utf8");
  return parseLabeledCsv(text);
}

async function loadFromDb(): Promise<LabeledRow[]> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set — add it to .env.local (required for DB mode).");
    process.exit(1);
  }
  const MAX_ROWS = parseInt(process.env.GIS_LIMIT ?? "200", 10);
  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const { rows } = await db.query<{
    address: string;
    owner_name: string | null;
    source_url: string;
  }>(
    `SELECT address, owner_name, source_url
     FROM properties
     WHERE source_url LIKE 'mdpa:%'
       AND address IS NOT NULL
       AND address <> ''
     ORDER BY created_at DESC
     LIMIT $1`,
    [MAX_ROWS]
  );
  await db.end();

  return rows.map((r) => {
    const strap = r.source_url.replace("mdpa:", "");
    const folio = normalizeFolio(strap);
    return {
      address: r.address,
      expectedOwner: r.owner_name,
      expectedFolio: folio,
      expectedStrap: folioToStrap(folio),
    };
  });
}

async function main() {
  const csvArg = process.argv[2];
  const mode = csvArg ? "csv" : "db";

  let labeled: LabeledRow[];
  try {
    labeled = csvArg ? await loadFromCsv(csvArg) : await loadFromDb();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (labeled.length === 0) {
    console.log(
      mode === "db"
        ? "\nNo MDPA-sourced properties found. Import tax-roll properties first, or pass a CSV.\n"
        : "\nCSV produced zero rows.\n"
    );
    process.exit(0);
  }

  console.log(`\n${HR}`);
  console.log("  Beacon — GIS accuracy harness");
  console.log(
    mode === "csv"
      ? `  Source: CSV  ${resolve(csvArg!)}  · ${labeled.length} labeled row${labeled.length === 1 ? "" : "s"}`
      : `  Source: live Supabase DB · ${labeled.length} MDPA-sourced propert${labeled.length === 1 ? "y" : "ies"}`
  );
  console.log(HR + "\n");

  const results: Result[] = [];

  for (let i = 0; i < labeled.length; i++) {
    const row = labeled[i];
    console.log(`  [${i + 1}/${labeled.length}] ${row.address}`);

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
        console.log(`       expected : ${row.expectedStrap}${ownerTag(row.expectedOwner)}`);
        console.log(`       ${TAG_LABEL.not_found}`);
        break;
      case "match": {
        const top = result.parcels[0];
        console.log(`       expected : ${row.expectedStrap}${ownerTag(row.expectedOwner)}`);
        console.log(`       GIS[1]   : ${folioToStrap(top.folio)}  "${top.address}"`);
        console.log(`       ${TAG_LABEL.match}`);
        break;
      }
      case "mismatch": {
        const top = result.parcels[0];
        console.log(`       expected : ${row.expectedStrap}${ownerTag(row.expectedOwner)}`);
        console.log(`       GIS[1]   : ${folioToStrap(top.folio)}  "${top.address}"`);
        if (result.foundAtRank !== undefined) {
          console.log(`                 expected folio appears at rank ${result.foundAtRank}`);
        }
        console.log(`       ${TAG_LABEL.mismatch}`);
        break;
      }
    }
    console.log();

    if (i < labeled.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  const c = {
    match: results.filter((r) => r.tag === "match").length,
    mismatch: results.filter((r) => r.tag === "mismatch").length,
    not_found: results.filter((r) => r.tag === "not_found").length,
    parse_error: results.filter((r) => r.tag === "parse_error").length,
    api_error: results.filter((r) => r.tag === "api_error").length,
  };
  const scored = c.match + c.mismatch + c.not_found;
  const matchPct = scored > 0 ? Math.round((c.match / scored) * 100) : 0;

  console.log(HR);
  console.log("  Summary");
  console.log(HR);
  console.log(`  Tested           : ${labeled.length}`);
  console.log(`  ✓  Match         : ${c.match}`);
  console.log(`  ✗  Mismatch      : ${c.mismatch}`);
  console.log(`  —  Not found     : ${c.not_found}`);
  if (c.parse_error) console.log(`  ⚠  Unparseable   : ${c.parse_error}`);
  if (c.api_error) console.log(`  !  API errors    : ${c.api_error}`);
  console.log();
  if (scored > 0) {
    console.log(`  Top-1 match rate : ${matchPct}%  (${c.match}/${scored} scored)`);
  }

  const mismatches = results.filter((r) => r.tag === "mismatch");
  if (mismatches.length > 0) {
    console.log();
    console.log(HR);
    console.log("  Mismatches — what GIS returned vs. expected");
    console.log(HR);
    for (const r of mismatches) {
      console.log(`\n  ┌─ ${r.row.address}${ownerTag(r.row.expectedOwner)}`);
      console.log(`  │  expected folio : ${r.row.expectedStrap}`);
      for (let i = 0; i < r.parcels.length; i++) {
        const p = r.parcels[i];
        const marker = p.folio === r.row.expectedFolio ? "  ← EXPECTED HERE" : "";
        console.log(`  │  GIS [${i + 1}]         : ${folioToStrap(p.folio)}  "${p.address}"${marker}`);
      }
      if (r.foundAtRank !== undefined) {
        console.log(`  │  → expected folio found at rank ${r.foundAtRank} (not top-1)`);
      } else {
        console.log(`  │  → expected folio absent from all GIS results`);
      }
      console.log("  └─");
    }
    console.log();
  }

  const notFound = results.filter((r) => r.tag === "not_found");
  if (notFound.length > 0) {
    console.log();
    console.log(HR);
    console.log("  Not found — GIS returned 0 results");
    console.log(HR);
    for (const r of notFound) {
      console.log(`  •  ${r.row.address}  (expected: ${r.row.expectedStrap})`);
    }
    console.log();
  }

  console.log(`\n${HR}\n`);
}

const isMain = process.argv[1]?.includes("check-gis-accuracy");
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
