export type ContactOccupancy = {
  propertyId: string | null;
  address: string | null;
  city: string | null;
  submarket: string | null;
  propertyType: string | null;
  sizeSqft: number | null;
  landSqft: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  ownerName: string | null;
  leasedSf: number | null;
  expiry: string | null;
  landlord: string | null;
  abstractId: string | null;
};

type PropRow = {
  id: string;
  address: string | null;
  city: string | null;
  submarket: string | null;
  property_type: string | null;
  size_sqft: number | null;
  land_sqft: number | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  owner_name: string | null;
};

type LeaseRow = {
  id: string;
  tenant_contact_id: string | null;
  linked_property: string | null;
  expiration_date: string | null;
  leased_sf: number | null;
  landlord_name: string | null;
};

export function buildContactOccupancy(
  linkedPropertyIds: string[],
  props: PropRow[],
  leases: LeaseRow[],
  contactId: string,
): ContactOccupancy {
  const tenantLease = leases.find((l) => l.tenant_contact_id === contactId);
  const propId = tenantLease?.linked_property ?? linkedPropertyIds[0] ?? null;
  const prop = propId ? props.find((p) => p.id === propId) : undefined;
  return {
    propertyId: prop?.id ?? propId,
    address: prop?.address ?? null,
    city: prop?.city ?? null,
    submarket: prop?.submarket ?? null,
    propertyType: prop?.property_type ?? null,
    sizeSqft: prop?.size_sqft ?? null,
    landSqft: prop?.land_sqft ?? null,
    lastSaleDate: prop?.last_sale_date ?? null,
    lastSalePrice: prop?.last_sale_price ?? null,
    ownerName: prop?.owner_name ?? null,
    leasedSf: tenantLease?.leased_sf ?? null,
    expiry: tenantLease?.expiration_date ?? null,
    landlord: tenantLease?.landlord_name ?? prop?.owner_name ?? null,
    abstractId: tenantLease?.id ?? null,
  };
}
