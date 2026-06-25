export interface SunbizMatch {
  entity_name: string;
  document_number: string;
  status: string;
  detail_path: string;
}

export interface SunbizPerson {
  name: string;
  title: string;
  address: string | null;
}

export interface SunbizResult {
  entity_name: string;
  document_number: string;
  status: string;
  principal_address: string | null;
  mailing_address: string | null;
  persons: SunbizPerson[];
  source_url: string;
}

export interface SunbizLookup {
  result: SunbizResult | null;
  matches_found: number;
}

export type { StoredOwnerContact } from "./owner-contacts";
