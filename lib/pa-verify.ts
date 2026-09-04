/** Public Property Appraiser verify URLs — no login, opens the county record. */

export type PaCounty = "miami-dade" | "broward" | "palm-beach" | "massachusetts";

export type PaVerify = {
  county: PaCounty;
  label: string;
  sourceName: string;
  strap: string;
  href: string;
};

export function paVerifyFromSourceUrl(sourceUrl: string | null | undefined): PaVerify | null {
  if (!sourceUrl) return null;
  if (sourceUrl.startsWith("mdpa:")) {
    const strap = sourceUrl.slice(5);
    return {
      county: "miami-dade",
      label: "MDPA",
      sourceName: "Miami-Dade Property Appraiser",
      strap,
      href: `https://www.miamidade.gov/Apps/PA/propertysearch/#/?strap=${strap.replace(/-/g, "")}`,
    };
  }
  if (sourceUrl.startsWith("bcpa:")) {
    const strap = sourceUrl.slice(5);
    return {
      county: "broward",
      label: "BCPA",
      sourceName: "Broward County Property Appraiser",
      strap,
      href: `https://gisweb-adapters.bcpa.net/bcpawebmap_ex_new_web/bcpawebmap.aspx?FOLIO=${strap.replace(/-/g, "")}`,
    };
  }
  if (sourceUrl.startsWith("pbcpa:")) {
    const strap = sourceUrl.slice(6);
    return {
      county: "palm-beach",
      label: "PBCPA",
      sourceName: "Palm Beach County Property Appraiser",
      strap,
      href: `https://pbcpao.gov/Property/Details?parcelId=${strap.replace(/-/g, "")}`,
    };
  }
  if (sourceUrl.startsWith("magis:")) {
    const strap = sourceUrl.slice(6);
    return {
      county: "massachusetts",
      label: "MassGIS",
      sourceName: "Massachusetts Property Tax Parcels",
      strap,
      href: `https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query?where=LOC_ID='${encodeURIComponent(strap)}'&outFields=*&f=json`,
    };
  }
  return null;
}
