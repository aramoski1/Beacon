// Copilot router — cheap Jev gate before Sonnet. High-confidence "cannot_do"
// returns an honest refusal. Everything else still goes to Claude.

import { jevChoice, jevDecide, jevEnabled } from "@/lib/jev";

export type CopilotRoute = "book" | "how_to" | "cannot_do";

const CANNOT_DO_EXAMPLES = [
  "send email from Beacon",
  "live CoStar / LoopNet login scrape",
  "CSV export (Beacon is XLSX only)",
  "calendar sync without Connections OAuth",
  "text or WhatsApp blast",
  "invent tax-roll docks or clear height",
];

export async function routeCopilotQuestion(latestUserText: string): Promise<CopilotRoute | null> {
  if (!jevEnabled()) return null;
  const decided = await jevDecide(
    { question: latestUserText, cannot_do_examples: CANNOT_DO_EXAMPLES },
    {
      route: {
        type: "choice",
        instructions:
          "Classify this Beacon Copilot question. book = data about the broker's properties/contacts/leases/deals. how_to = how to use Beacon (buttons, pages). cannot_do = something Beacon explicitly does not have (send email, live CoStar API, CSV, invented GIS filters).",
        criteria: {
          book: "Portfolio, contacts, leases, deals, follow-ups, who is overdue",
          how_to: "Where is a button, how do I import, customize dashboard, settings",
          cannot_do: "A capability Beacon does not have",
        },
      },
    },
  );
  const pick = jevChoice(decided, "route");
  if (!pick) return null;
  if (pick.choice === "cannot_do" && pick.confidence >= 0.85) return "cannot_do";
  if (pick.choice === "how_to" && pick.confidence >= 0.55) return "how_to";
  if (pick.choice === "book" && pick.confidence >= 0.45) return "book";
  return null;
}

export const COPILOT_CANNOT_DO_REPLY =
  "Beacon doesn't have that. If you're trying to do something in your book or learn a screen, ask that instead — or open **How Beacon works**.";
