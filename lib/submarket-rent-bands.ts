/** Static tri-county industrial rent bands — seed data, not live CoStar. */

export type RentBand = {
  county: "miami-dade" | "broward" | "palm-beach";
  submarket: string;
  nnnPsfLow: number;
  nnnPsfHigh: number;
  notes: string;
};

export const TRI_COUNTY_INDUSTRIAL_RENT_BANDS: RentBand[] = [
  { county: "miami-dade", submarket: "Airport West / Doral", nnnPsfLow: 16, nnnPsfHigh: 22, notes: "Infill warehouse / last-mile" },
  { county: "miami-dade", submarket: "Medley", nnnPsfLow: 14, nnnPsfHigh: 19, notes: "Older stock + newer infill" },
  { county: "miami-dade", submarket: "Hialeah", nnnPsfLow: 13, nnnPsfHigh: 18, notes: "Mixed vintage" },
  { county: "miami-dade", submarket: "South Dade / Homestead", nnnPsfLow: 12, nnnPsfHigh: 16, notes: "Agriculture-adjacent industrial" },
  { county: "broward", submarket: "Pompano / Copans", nnnPsfLow: 13, nnnPsfHigh: 18, notes: "I-95 warehouse corridor" },
  { county: "broward", submarket: "Miramar / Pembroke", nnnPsfLow: 14, nnnPsfHigh: 19, notes: "Turnpike / I-75" },
  { county: "broward", submarket: "Port Everglades / Ft Lauderdale", nnnPsfLow: 15, nnnPsfHigh: 21, notes: "Port-adjacent" },
  { county: "palm-beach", submarket: "Riviera Beach / Port of PB", nnnPsfLow: 12, nnnPsfHigh: 17, notes: "Port industrial" },
  { county: "palm-beach", submarket: "West Palm Beach", nnnPsfLow: 13, nnnPsfHigh: 18, notes: "Infill flex / warehouse" },
  { county: "palm-beach", submarket: "Boca Raton / Delray", nnnPsfLow: 14, nnnPsfHigh: 20, notes: "Flex + R&D" },
];

export function lookupRentBand(submarket: string | null): RentBand | null {
  if (!submarket?.trim()) return null;
  const needle = submarket.trim().toLowerCase();
  return (
    TRI_COUNTY_INDUSTRIAL_RENT_BANDS.find((b) =>
      needle.includes(b.submarket.split("/")[0].trim().toLowerCase()) ||
      b.submarket.toLowerCase().includes(needle) ||
      needle.includes(b.submarket.toLowerCase()),
    ) ?? null
  );
}

export function formatRentBand(band: RentBand): string {
  return `$${band.nnnPsfLow}–$${band.nnnPsfHigh} NNN/SF`;
}
