// ADD-only Sunbiz: regex already catches LLC/INC. Jev can flag other
// entity-looking names (Trust, Holdings, LP spelled out). Never skips county.

import { jevDecide, jevEnabled, jevIsYes, jevNoul } from "@/lib/jev";
import { isEntityOwnerName } from "@/lib/owner-contacts";

export function shouldLookupSunbizName(
  name: string | null | undefined,
  jevEntity: boolean | null,
): boolean {
  if (isEntityOwnerName(name)) return true;
  return jevEntity === true;
}

export async function jevLooksLikeEntityOwner(
  name: string | null | undefined,
): Promise<boolean | null> {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || !jevEnabled()) return null;
  if (isEntityOwnerName(trimmed)) return true;

  const decided = await jevDecide(
    { owner_name: trimmed },
    {
      entity: {
        type: "noul",
        instructions:
          "This owner name is a company, trust, or registered entity (not a person's first+last name). Florida Sunbiz would have a filing.",
      },
    },
  );
  const n = jevNoul(decided, "entity");
  if (n == null) return null;
  return jevIsYes(n, 0.75);
}
