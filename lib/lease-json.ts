export type KeyProvision = { provision: string; citation?: string };

export function asKeyProvisions(value: unknown): KeyProvision[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" && item.trim()) return { provision: item.trim() };
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          const provision = String(rec.provision ?? rec.text ?? rec.notes ?? "").trim();
          if (!provision) return null;
          const citation = typeof rec.citation === "string" ? rec.citation : undefined;
          return { provision, citation };
        }
        return null;
      })
      .filter((x): x is KeyProvision => x != null);
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const lines = [rec.tenant, rec.use, rec.notes, rec.provision]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
    return lines.map((provision) => ({ provision }));
  }
  return [];
}

export function asLeaseArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
