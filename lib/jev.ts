// TypeSafe Jev — System One decisions (choice / score / noul).
// Server-only. Reads JEV_API_KEY or TYPESAFE_API_KEY. Never import from client.

export const JEV_DEFAULT_MODEL = "jev-1.13.0";
export const JEV_DEFAULT_URL = "https://api.typesafe.ai/v1/systemone";

export type JevNoulQ = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};
export type JevChoiceQ = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type JevScoreQ = {
  type: "score";
  instructions: string;
  criteria: string[];
};
export type JevQuestion = JevNoulQ | JevChoiceQ | JevScoreQ;

export type JevNoulA = { type: "noul"; noul: number };
export type JevChoiceA = {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};
export type JevScoreA = {
  type: "score";
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
};
export type JevAnswer = JevNoulA | JevChoiceA | JevScoreA;

export type JevDecideResult = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
};

export function jevApiKey(): string | null {
  const key =
    process.env.JEV_API_KEY?.trim() ||
    process.env.TYPESAFE_API_KEY?.trim() ||
    null;
  return key || null;
}

export function jevEnabled(): boolean {
  return Boolean(jevApiKey());
}

export function jevModel(): string {
  return process.env.JEV_MODEL?.trim() || JEV_DEFAULT_MODEL;
}

export function jevApiUrl(): string {
  return process.env.JEV_API_URL?.trim() || JEV_DEFAULT_URL;
}

function asNoul(raw: unknown): JevNoulA | null {
  if (!raw || typeof raw !== "object") return null;
  const n = (raw as { noul?: unknown }).noul;
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return { type: "noul", noul: Math.min(1, Math.max(0, n)) };
}

function asChoice(raw: unknown): JevChoiceA | null {
  if (!raw || typeof raw !== "object") return null;
  const choice = (raw as { choice?: unknown }).choice;
  if (typeof choice !== "string" || !choice) return null;
  const confidence = (raw as { confidence?: unknown }).confidence;
  const probabilities = (raw as { probabilities?: unknown }).probabilities;
  return {
    type: "choice",
    choice,
    confidence: typeof confidence === "number" ? confidence : undefined,
    probabilities:
      probabilities && typeof probabilities === "object"
        ? (probabilities as Record<string, number>)
        : undefined,
  };
}

function asScore(raw: unknown): JevScoreA | null {
  if (!raw || typeof raw !== "object") return null;
  const score = (raw as { score?: unknown }).score;
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  const confidence = (raw as { confidence?: unknown }).confidence;
  return {
    type: "score",
    score,
    confidence: typeof confidence === "number" ? confidence : undefined,
  };
}

function parseAnswer(expected: JevQuestion["type"], raw: unknown): JevAnswer | null {
  if (expected === "noul") return asNoul(raw);
  if (expected === "choice") return asChoice(raw);
  return asScore(raw);
}

/** One round trip. Returns null if Jev is off or the call fails — callers keep their fallback. */
export async function jevDecide(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevDecideResult | null> {
  const key = jevApiKey();
  if (!key) return null;
  const names = Object.keys(questions);
  if (names.length === 0) return null;

  let res: Response;
  try {
    res = await fetch(jevApiUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: jevModel(),
        state,
        questions,
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;

  const rawAnswers = (json as { answers?: unknown }).answers;
  if (!rawAnswers || typeof rawAnswers !== "object") return null;

  const answers: Record<string, JevAnswer> = {};
  for (const name of names) {
    const parsed = parseAnswer(questions[name].type, (rawAnswers as Record<string, unknown>)[name]);
    if (!parsed) return null;
    answers[name] = parsed;
  }

  const model =
    typeof (json as { model?: unknown }).model === "string"
      ? (json as { model: string }).model
      : jevModel();
  const usage = (json as { usage?: JevDecideResult["usage"] }).usage;

  return { model, answers, usage };
}

export function jevNoul(result: JevDecideResult | null, name: string): number | null {
  const a = result?.answers[name];
  return a?.type === "noul" ? a.noul : null;
}

export function jevChoice(
  result: JevDecideResult | null,
  name: string,
): { choice: string; confidence: number } | null {
  const a = result?.answers[name];
  if (a?.type !== "choice") return null;
  const fromProbs = a.probabilities?.[a.choice];
  const confidence =
    typeof a.confidence === "number"
      ? a.confidence
      : typeof fromProbs === "number"
        ? fromProbs
        : 0;
  return { choice: a.choice, confidence };
}

export function jevScore(result: JevDecideResult | null, name: string): number | null {
  const a = result?.answers[name];
  return a?.type === "score" ? a.score : null;
}

export function jevIsYes(noul: number | null, threshold = 0.7): boolean {
  return noul != null && noul >= threshold;
}

/** Truncate page/document text so a Jev state payload stays small. */
export function jevTextPreview(text: string, max = 1800): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
