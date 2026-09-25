// After Haiku drafts: warn, do not block. Invented specs / generic openers
// / group-email tone get a broker-visible warning.

import { jevDecide, jevEnabled, jevIsYes, jevNoul, type JevQuestion } from "@/lib/jev";

export type OutreachQaInput = {
  contactId: string;
  subject: string;
  body: string;
};

export function outreachWarningFromNouls(flags: {
  invented?: number | null;
  generic?: number | null;
  group?: number | null;
}): string | null {
  const bits: string[] = [];
  if (jevIsYes(flags.invented ?? null, 0.75)) {
    bits.push("may invent a spec (dock, clear height, rent) that is not in the contact data");
  }
  if (jevIsYes(flags.generic ?? null, 0.75)) {
    bits.push("reads like a generic check-in");
  }
  if (jevIsYes(flags.group ?? null, 0.8)) {
    bits.push("reads like a group blast, not one person");
  }
  return bits.length ? `Review before you send: ${bits.join("; ")}.` : null;
}

export async function qaOutreachDrafts(
  drafts: OutreachQaInput[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!jevEnabled() || drafts.length === 0) return out;

  const chunk = drafts.slice(0, 10);
  const questions: Record<string, JevQuestion> = {};
  for (const d of chunk) {
    questions[`${d.contactId}__invented`] = {
      type: "noul",
      instructions:
        "The draft invents a dock count, clear height, asking rent, cap rate, or other industrial spec that is not implied by the text as a merge token.",
    };
    questions[`${d.contactId}__generic`] = {
      type: "noul",
      instructions:
        "The draft opens with a generic hope-this-finds-you / just-checking-in and has no specific property, lease, or last-touch fact.",
    };
    questions[`${d.contactId}__group`] = {
      type: "noul",
      instructions: "The draft is written to a group or 'owners' rather than one named person.",
    };
  }

  const decided = await jevDecide(
    {
      drafts: chunk.map((d) => ({
        id: d.contactId,
        subject: d.subject,
        body: d.body.slice(0, 800),
      })),
    },
    questions,
  );
  if (!decided) return out;

  for (const d of chunk) {
    const warning = outreachWarningFromNouls({
      invented: jevNoul(decided, `${d.contactId}__invented`),
      generic: jevNoul(decided, `${d.contactId}__generic`),
      group: jevNoul(decided, `${d.contactId}__group`),
    });
    if (warning) out[d.contactId] = warning;
  }
  return out;
}
