const TITLE_PREFIX =
  /^(site supervisor|facilities dir\.?|facilities director|ops manager|re coord\.?|re coordinator|site lead|plant mgr\.?|plant manager|gm|managing member|principal)\s+/i;

export function splitContactName(full: string | null | undefined): {
  title: string | null;
  firstName: string;
  lastName: string;
  greeting: string;
} {
  const raw = (full ?? "").trim();
  if (!raw) return { title: null, firstName: "", lastName: "", greeting: "there" };

  const comma = raw.match(/^([^,]+),\s*(.+)$/);
  if (comma) {
    const lastName = comma[1].trim();
    const firstName = comma[2].trim().split(/\s+/)[0] ?? lastName;
    return { title: null, firstName, lastName, greeting: firstName || "there" };
  }

  const titled = raw.match(TITLE_PREFIX);
  const title = titled ? titled[1].replace(/\.$/, "") : null;
  const rest = titled ? raw.slice(titled[0].length).trim() : raw;
  const parts = rest.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? rest;
  const lastName = parts.slice(1).join(" ");
  return { title, firstName, lastName, greeting: firstName || "there" };
}
