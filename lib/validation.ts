// Pure validation helpers. No server/client directive — importable anywhere.
// Used by server actions for input validation before any database access.

export type ValidationError = { field: string; message: string };

/** True when a string matches YYYY-MM-DD and resolves to a real calendar date. */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** Permissive RFC-5321 email check. */
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/** Name must be present and ≤ 200 chars. */
export function validateName(
  name: string | null | undefined,
  field = "name",
): ValidationError | null {
  if (!name?.trim()) return { field, message: "Name is required." };
  if (name.trim().length > 200)
    return { field, message: "Name must be 200 characters or fewer." };
  return null;
}

/** Optional email — only validated when non-empty. */
export function validateEmail(
  email: string | null | undefined,
  field = "email",
): ValidationError | null {
  if (!email) return null;
  if (!isValidEmail(email)) return { field, message: "Invalid email address." };
  return null;
}

/** Required YYYY-MM-DD date string. */
export function validateRequiredDate(
  date: string | null | undefined,
  field = "date",
): ValidationError | null {
  if (!date?.trim()) return { field, message: `${field} is required.` };
  if (!isValidDate(date))
    return { field, message: `${field} must be a valid date (YYYY-MM-DD).` };
  return null;
}

/** Optional YYYY-MM-DD — only validated when non-empty. */
export function validateOptionalDate(
  date: string | null | undefined,
  field = "date",
): ValidationError | null {
  if (!date?.trim()) return null;
  if (!isValidDate(date))
    return { field, message: `${field} must be a valid date (YYYY-MM-DD).` };
  return null;
}

/** Subject: required, max 500. Body: required, max 10 000. */
export function validateOutreach(
  subject: string,
  body: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!subject.trim())
    errors.push({ field: "subject", message: "Subject is required." });
  else if (subject.length > 500)
    errors.push({ field: "subject", message: "Subject must be 500 characters or fewer." });

  if (!body.trim())
    errors.push({ field: "body", message: "Body is required." });
  else if (body.length > 10_000)
    errors.push({ field: "body", message: "Body must be 10,000 characters or fewer." });
  return errors;
}
