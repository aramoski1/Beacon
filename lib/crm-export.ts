/**
 * Build export download URLs for Workspace (full book vs selected ids).
 */

const MAX_EXPORT_IDS = 200;

export function exportIdsQuery(ids: string[]): string | null {
  if (ids.length === 0) return null;
  if (ids.length > MAX_EXPORT_IDS) return null;
  return ids.join(",");
}

export function propertiesExportHref(ids?: string[]): string {
  const q = ids ? exportIdsQuery(ids) : null;
  return q ? `/api/export/properties?ids=${encodeURIComponent(q)}` : "/api/export/properties";
}

export function contactsExportHref(ids?: string[]): string {
  const q = ids ? exportIdsQuery(ids) : null;
  return q ? `/api/export/contacts?ids=${encodeURIComponent(q)}` : "/api/export/contacts";
}

export { MAX_EXPORT_IDS };
