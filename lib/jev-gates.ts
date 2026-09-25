// Jev gates before expensive Opus extract. Fail open: missing key, API
// error, or a middling noul all proceed. Only skip when Jev is confident
// the source is the wrong page / not a property document.

import { jevDecide, jevEnabled, jevNoul, jevTextPreview } from "@/lib/jev";

/** Skip only when Jev is fairly sure this is NOT a match. */
const REJECT_BELOW = 0.3;

async function allowNoul(
  state: unknown,
  name: string,
  instructions: string,
): Promise<boolean> {
  if (!jevEnabled()) return true;
  const decided = await jevDecide(state, {
    [name]: { type: "noul", instructions },
  });
  const n = jevNoul(decided, name);
  if (n == null) return true;
  return n >= REJECT_BELOW;
}

export async function jevAllowsListingExtract(input: {
  address: string;
  city: string | null;
  url: string;
  pageText: string;
}): Promise<boolean> {
  return allowNoul(
    {
      address: input.address,
      city: input.city,
      url: input.url,
      page: jevTextPreview(input.pageText),
    },
    "same_listing",
    "This page or snippet is a listing (or quoted listing specs) for THIS street address — not a search results page, a different address, a news article, or a tax-roll folio with no listing specs.",
  );
}

export async function jevAllowsDocumentExtract(input: {
  address: string | null;
  sourceKind: string;
  text: string | null;
}): Promise<boolean> {
  if (!input.text) return true;
  return allowNoul(
    {
      address: input.address,
      source_kind: input.sourceKind,
      page: jevTextPreview(input.text),
    },
    "same_property_doc",
    "This source is a listing, OM, flyer, or property document with extractable CRE facts for the named address (or a specific property if no address). False if it is unrelated boilerplate, a homepage, a search results page, or empty.",
  );
}

export async function jevAllowsUrlIngest(input: {
  url: string;
  pageText: string;
}): Promise<boolean> {
  return allowNoul(
    {
      url: input.url,
      page: jevTextPreview(input.pageText),
    },
    "is_listing_page",
    "This page is a specific commercial property listing or offering memo (has an address and stated specs), not a search SERP, directory homepage, login wall, or news article.",
  );
}
