import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { DEAL_TYPE_LABELS, STAGE_LABELS, type Deal, type DealType, type DealStage } from "@/lib/deals";

export type LoiContext = {
  deal: Pick<Deal, "name" | "deal_type" | "stage" | "estimated_commission" | "notes" | "expected_close_date">;
  propertyAddress: string | null;
  contactName: string | null;
  contactCompany: string | null;
  brokerName: string | null;
  company: string | null;
};

export function loiFileName(dealName: string): string {
  const slug = dealName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `LOI-${slug || "draft"}.docx`;
}

export async function buildLoiDocx(ctx: LoiContext): Promise<Uint8Array> {
  const typeLabel = DEAL_TYPE_LABELS[(ctx.deal.deal_type as DealType) ?? "tenant_rep"] ?? ctx.deal.deal_type;
  const stageLabel = STAGE_LABELS[(ctx.deal.stage as DealStage)] ?? ctx.deal.stage;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "LETTER OF INTENT", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: today, spacing: { after: 240 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Re: ", bold: true }),
              new TextRun(ctx.deal.name),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Property: ", bold: true }),
              new TextRun(ctx.propertyAddress ?? "—"),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Counterparty: ", bold: true }),
              new TextRun([ctx.contactName, ctx.contactCompany].filter(Boolean).join(" · ") || "—"),
            ],
            spacing: { after: 240 },
          }),
          new Paragraph({
            text: `This non-binding letter of intent outlines proposed terms for a ${typeLabel} pursuit currently in ${stageLabel}. It is a Beacon draft for the broker to edit before sending — it is not legal advice and creates no obligation.`,
            spacing: { after: 200 },
          }),
          new Paragraph({ text: "Proposed terms", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({
            children: [
              new TextRun({ text: "Estimated commission: ", bold: true }),
              new TextRun(
                ctx.deal.estimated_commission != null
                  ? `$${Number(ctx.deal.estimated_commission).toLocaleString()}`
                  : "TBD",
              ),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Target close / occupancy: ", bold: true }),
              new TextRun(ctx.deal.expected_close_date ?? "TBD"),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Notes: ", bold: true }),
              new TextRun(ctx.deal.notes?.trim() || "None recorded in Beacon."),
            ],
            spacing: { after: 240 },
          }),
          new Paragraph({
            text: "Please confirm whether these terms are acceptable as a basis for a formal LOI or PSA. This draft should be reviewed by counsel before circulation.",
            spacing: { after: 300 },
          }),
          new Paragraph({ text: ctx.brokerName || "Broker" }),
          new Paragraph({ text: ctx.company || "Beacon" }),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
