import fs from "fs";
import path from "path";

try {
  const raw = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (name && process.env[name] == null) process.env[name] = value;
  }
} catch {
  // no local env in CI
}
