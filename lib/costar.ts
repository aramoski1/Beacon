// CoStar "About the Owner" export parser.
// No credential storage, no scraping — file upload only.
// Model only structures what the file contains; never invents data.

import Anthropic from "@anthropic-ai/sdk";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoStarContact {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

export interface CoStarOwner {
  company_name: string | null;
  website: string | null;
  hq_address: string | null;
  contacts: CoStarContact[];
}

type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type CoStarFileContent =
  | { type: "pdf"; buffer: Buffer }
  | { type: "image"; buffer: Buffer; mimeType: ImageMimeType }
  | { type: "text"; text: string };

// ─── Claude tool ──────────────────────────────────────────────────────────────

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_costar_owner",
  description:
    "Extract all owner and contact information from a CoStar 'About the Owner' export. " +
    "Return ONLY what is explicitly present in the file — never guess or invent missing data. " +
    "If a field is not in the file, set it to null.",
  input_schema: {
    type: "object" as const,
    required: ["contacts"],
    properties: {
      company_name: {
        type: ["string", "null"],
        description: "Owner company or entity name, if listed",
      },
      website: {
        type: ["string", "null"],
        description: "Company website URL, if listed",
      },
      hq_address: {
        type: ["string", "null"],
        description: "Headquarters or mailing address of the company, if listed",
      },
      contacts: {
        type: "array",
        description: "Every individual contact person found in the export",
        items: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            title: { type: ["string", "null"], description: "Job title or role" },
            email: { type: ["string", "null"] },
            phone: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};

type ExtractOutput = {
  company_name?: string | null;
  website?: string | null;
  hq_address?: string | null;
  contacts: Array<{
    name: string;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
  }>;
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function extractCoStarOwner(
  content: CoStarFileContent
): Promise<CoStarOwner> {
  const anthropic = new Anthropic();
  const prompt =
    "Extract all owner and contact information from this CoStar export using the extract_costar_owner tool.";

  let userContent: Anthropic.MessageParam["content"];

  if (content.type === "pdf") {
    userContent = [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: content.buffer.toString("base64"),
        },
      },
      { type: "text", text: prompt },
    ] as Anthropic.MessageParam["content"];
  } else if (content.type === "image") {
    userContent = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: content.mimeType,
          data: content.buffer.toString("base64"),
        },
      },
      { type: "text", text: prompt },
    ] as Anthropic.MessageParam["content"];
  } else {
    userContent = `${content.text}\n\n${prompt}`;
  }

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system:
      "You extract structured contact data from CoStar 'About the Owner' exports. " +
      "Return ONLY what is explicitly present — never invent or infer missing data.",
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "extract_costar_owner" },
    messages: [{ role: "user", content: userContent }],
  });

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Claude did not return structured extraction from CoStar file.");
  }

  const raw = block.input as ExtractOutput;
  return {
    company_name: raw.company_name?.trim() || null,
    website: raw.website?.trim() || null,
    hq_address: raw.hq_address?.trim() || null,
    contacts: (raw.contacts ?? []).map((c) => ({
      name: c.name.trim(),
      title: c.title?.trim() || null,
      email: c.email?.trim() || null,
      phone: c.phone?.trim() || null,
    })),
  };
}
