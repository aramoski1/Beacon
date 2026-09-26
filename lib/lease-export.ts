// Lease abstract export — Word, Excel, PDF, ICS.
// All functions except triggerDownload work in both Node.js and browser.

import * as XLSX from "xlsx";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, TableRow, TableCell, Table,
  WidthType, convertInchesToTwip,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatPsf } from "@/lib/format-money";

// ─── Shared types ──────────────────────────────────────────────────────────────

export type LeaseAbstractExport = {
  id: string;
  source_document: string | null;
  execution_date: string | null;
  expiration_date: string | null;
  term: string | null;
  base_rate: number | null;
  escalations: { description: string; rate: string; effective_date?: string }[];
  options: { type: string; description: string; notice_period?: string }[];
  key_provisions: { provision: string; citation?: string }[];
  field_citations: { field: string; page: string; text: string }[];
  custom_fields?: Record<string, string | number | null> | null;
};

export type NoticePeriod = { amount: number; unit: "days" | "months" | "years" };

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

export function sourceFileName(path: string | null): string {
  if (!path) return "Unknown file";
  return path.split("/").pop() ?? path;
}

// ─── Notice period parsing ─────────────────────────────────────────────────────

export function parseNoticePeriod(s: string): NoticePeriod | null {
  const lower = s.toLowerCase().trim();
  const monthMatch = lower.match(/(\d+)\s*-?\s*months?/);
  if (monthMatch) return { amount: parseInt(monthMatch[1], 10), unit: "months" };
  const yearMatch = lower.match(/(\d+)\s*-?\s*years?/);
  if (yearMatch) return { amount: parseInt(yearMatch[1], 10), unit: "years" };
  const dayMatch = lower.match(/(\d+)\s*-?\s*days?/);
  if (dayMatch) return { amount: parseInt(dayMatch[1], 10), unit: "days" };
  return null;
}

export function subtractNoticePeriod(isoDate: string, period: NoticePeriod): string {
  // Use noon UTC to avoid DST boundary issues
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (period.unit === "days") d.setUTCDate(d.getUTCDate() - period.amount);
  else if (period.unit === "months") d.setUTCMonth(d.getUTCMonth() - period.amount);
  else d.setUTCFullYear(d.getUTCFullYear() - period.amount);
  return d.toISOString().slice(0, 10);
}

// ─── Critical dates ────────────────────────────────────────────────────────────

export type CriticalDate = {
  label: string;
  date: string;
  description: string;
};

export function buildCriticalDates(abstract: LeaseAbstractExport): CriticalDate[] {
  const dates: CriticalDate[] = [];

  if (abstract.expiration_date) {
    dates.push({
      label: "Lease Expiration",
      date: abstract.expiration_date,
      description: `Lease expires. Source: ${sourceFileName(abstract.source_document)}`,
    });
  }

  for (const opt of abstract.options) {
    if (!opt.notice_period || !abstract.expiration_date) continue;
    const period = parseNoticePeriod(opt.notice_period);
    if (!period) continue;
    const deadline = subtractNoticePeriod(abstract.expiration_date, period);
    dates.push({
      label: `Notice Deadline — ${opt.type.charAt(0).toUpperCase()}${opt.type.slice(1)} Option`,
      date: deadline,
      description: `${opt.notice_period} notice required for ${opt.type} option. ${opt.description}`,
    });
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date));
}

const MS_DAY = 86_400_000;

/** Normalize lease_abstracts.options JSONB into the export shape. */
export function optionsFromJson(raw: unknown): LeaseAbstractExport["options"] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      type: typeof o.type === "string" && o.type.trim() ? o.type : "option",
      description: typeof o.description === "string" ? o.description : "",
      notice_period: typeof o.notice_period === "string" ? o.notice_period : undefined,
    };
  });
}

export function daysUntilIso(isoDate: string, today: string): number {
  return Math.ceil(
    (new Date(isoDate + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) /
      MS_DAY,
  );
}

/**
 * Soonest option-notice deadline for a lease. Prefers an upcoming date;
 * if every notice is in the past, returns the most recently passed one.
 */
export function nearestNoticeDeadline(
  expirationDate: string | null,
  options: unknown,
  today: string,
): { date: string; label: string; daysUntil: number } | null {
  if (!expirationDate) return null;
  const notices = buildCriticalDates({
    id: "tmp",
    source_document: null,
    execution_date: null,
    expiration_date: expirationDate,
    term: null,
    base_rate: null,
    escalations: [],
    options: optionsFromJson(options),
    key_provisions: [],
    field_citations: [],
  }).filter((d) => d.label.startsWith("Notice Deadline"));
  if (notices.length === 0) return null;

  const withDays = notices.map((d) => ({
    date: d.date,
    label: d.label,
    daysUntil: daysUntilIso(d.date, today),
  }));
  const upcoming = withDays
    .filter((d) => d.daysUntil >= 0)
    .sort((a, b) => a.daysUntil - b.daysUntil);
  if (upcoming[0]) return upcoming[0];
  return withDays.sort((a, b) => b.daysUntil - a.daysUntil)[0] ?? null;
}

// ─── ICS ───────────────────────────────────────────────────────────────────────

function icsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcsString(abstract: LeaseAbstractExport): string {
  const dates = buildCriticalDates(abstract);
  if (dates.length === 0) return "";

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const events = dates
    .map(({ label, date, description }, i) => [
      "BEGIN:VEVENT",
      `UID:beacon-lease-${abstract.id}-${i}@beacon`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(date)}`,
      `DTEND;VALUE=DATE:${icsDate(date)}`,
      `SUMMARY:${icsEscape(label)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      "END:VEVENT",
    ].join("\r\n"))
    .join("\r\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Beacon CRM//Beacon//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    events,
    "END:VCALENDAR",
  ].join("\r\n");
}

// ─── Excel ─────────────────────────────────────────────────────────────────────

export function buildExcelBytes(abstract: LeaseAbstractExport): Uint8Array {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Abstract (key/value)
  const abstractRows: (string | number | null)[][] = [
    ["Field", "Value"],
    ["Source Document", sourceFileName(abstract.source_document)],
    ["Execution Date", abstract.execution_date ?? ""],
    ["Expiration Date", abstract.expiration_date ?? ""],
    ["Term", abstract.term ?? ""],
    ["Base Rate ($/sf)", abstract.base_rate ?? ""],
  ];
  if (abstract.escalations.length > 0) {
    abstractRows.push(["", ""]);
    abstractRows.push(["ESCALATIONS", ""]);
    abstract.escalations.forEach((e, i) => {
      abstractRows.push([
        `Escalation ${i + 1}`,
        `${e.description} — ${e.rate}${e.effective_date ? ` (eff. ${e.effective_date})` : ""}`,
      ]);
    });
  }
  if (abstract.options.length > 0) {
    abstractRows.push(["", ""]);
    abstractRows.push(["OPTIONS", ""]);
    abstract.options.forEach((o, i) => {
      abstractRows.push([
        `Option ${i + 1} (${o.type})`,
        `${o.description}${o.notice_period ? ` · Notice: ${o.notice_period}` : ""}`,
      ]);
    });
  }
  if (abstract.key_provisions.length > 0) {
    abstractRows.push(["", ""]);
    abstractRows.push(["KEY PROVISIONS", ""]);
    abstract.key_provisions.forEach((kp, i) => {
      abstractRows.push([
        `Provision ${i + 1}`,
        kp.provision + (kp.citation ? ` (§${kp.citation})` : ""),
      ]);
    });
  }
  if (abstract.custom_fields) {
    const entries = Object.entries(abstract.custom_fields);
    if (entries.length > 0) {
      abstractRows.push(["", ""]);
      abstractRows.push(["CUSTOM FIELDS", ""]);
      for (const [k, v] of entries) {
        abstractRows.push([k, v ?? ""]);
      }
    }
  }
  const ws1 = XLSX.utils.aoa_to_sheet(abstractRows);
  ws1["!cols"] = [{ wch: 28 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Abstract");

  // Sheet 2 — Critical Dates
  const critDates = buildCriticalDates(abstract);
  const dateRows: (string | null)[][] = [
    ["Event", "Date", "Description"],
    ...critDates.map(({ label, date, description }) => [label, date, description]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(dateRows);
  ws2["!cols"] = [{ wch: 40 }, { wch: 14 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Critical Dates");

  // Sheet 3 — Source Citations
  const citRows: (string)[][] = [
    ["Field", "Page", "Excerpt"],
    ...abstract.field_citations.map(c => [c.field, c.page, c.text]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(citRows);
  ws3["!cols"] = [{ wch: 22 }, { wch: 8 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Citations");

  // xlsx "array" type returns ArrayBuffer in Node and Uint8Array in browsers; normalise all
  const raw: ArrayBuffer | Uint8Array | number[] = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return Uint8Array.from(raw);
}

// ─── Word ──────────────────────────────────────────────────────────────────────

function h2(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
  });
}

function fieldPara(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 20, color: "555555" }),
      new TextRun({ text: value || "—", size: 20 }),
    ],
    spacing: { after: 60 },
  });
}

function bulletPara(text: string): Paragraph {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 60 },
  });
}

function citeTable(citations: { field: string; page: string; text: string }[]): Table {
  const header = new TableRow({
    children: ["Field", "Page", "Excerpt"].map(t =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 18 })] })],
        shading: { fill: "F0F0F0" },
        width: { size: t === "Excerpt" ? 60 : t === "Page" ? 10 : 30, type: WidthType.PERCENTAGE },
        borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } },
      })
    ),
  });
  const rows = citations.map(
    c =>
      new TableRow({
        children: [c.field, c.page, `"${c.text.slice(0, 120)}${c.text.length > 120 ? "…" : ""}"`].map((t, col) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: t, size: 16, font: col === 0 ? "Courier New" : undefined })],
              }),
            ],
            width: { size: col === 2 ? 60 : col === 1 ? 10 : 30, type: WidthType.PERCENTAGE },
          })
        ),
      })
  );
  return new Table({ rows: [header, ...rows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

export async function buildWordBytes(abstract: LeaseAbstractExport): Promise<Uint8Array> {
  const fileName = sourceFileName(abstract.source_document);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: "LEASE ABSTRACT",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Source: ", bold: true, size: 20, color: "555555" }),
        new TextRun({ text: fileName, size: 20 }),
        new TextRun({ text: "   ·   Abstracted: ", bold: true, size: 20, color: "555555" }),
        new TextRun({ text: today, size: 20 }),
      ],
      spacing: { after: 200 },
    }),

    h2("Core Terms"),
    fieldPara("Execution Date", formatDate(abstract.execution_date)),
    fieldPara("Expiration Date", formatDate(abstract.expiration_date)),
    fieldPara("Term", abstract.term ?? "—"),
    fieldPara("Base Rate", abstract.base_rate != null ? (formatPsf(abstract.base_rate) ?? "—") : "—"),
  ];

  if (abstract.escalations.length > 0) {
    children.push(h2("Escalations"));
    for (const [i, e] of abstract.escalations.entries()) {
      children.push(
        bulletPara(
          `${e.description} — ${e.rate}${e.effective_date ? ` (effective ${e.effective_date})` : ""}`,
        )
      );
    }
  }

  if (abstract.options.length > 0) {
    children.push(h2("Options"));
    for (const o of abstract.options) {
      children.push(
        bulletPara(
          `[${o.type.toUpperCase()}] ${o.description}${o.notice_period ? `  ·  Notice: ${o.notice_period}` : ""}`,
        )
      );
    }
  }

  if (abstract.key_provisions.length > 0) {
    children.push(h2("Key Provisions"));
    for (const kp of abstract.key_provisions) {
      children.push(
        bulletPara(kp.provision + (kp.citation ? `  (§${kp.citation})` : ""))
      );
    }
  }

  const critDates = buildCriticalDates(abstract);
  if (critDates.length > 0) {
    children.push(h2("Critical Dates"));
    for (const d of critDates) {
      children.push(fieldPara(d.label, `${formatDate(d.date)}  —  ${d.description}`));
    }
  }

  if (abstract.field_citations.length > 0) {
    children.push(h2("Source Citations"));
    children.push(new Paragraph({ spacing: { after: 80 } }));
    children.push(citeTable(abstract.field_citations));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 20 },
        },
      },
    },
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
}

// ─── PDF ───────────────────────────────────────────────────────────────────────

function wrapLines(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxW: number): string[] {
  if (!text) return ["—"];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) <= maxW) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      cur = w.length > 1 && font.widthOfTextAtSize(w, size) > maxW
        ? w.slice(0, Math.floor(w.length * maxW / font.widthOfTextAtSize(w, size)) - 1) + "…"
        : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : ["—"];
}

export async function buildPdfBytes(abstract: LeaseAbstractExport): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PW = 612, PH = 792, M = 54, LH = 15;
  const LABEL_W = 130;
  const gray = rgb(0.45, 0.45, 0.45);
  const black = rgb(0, 0, 0);
  const lightGray = rgb(0.75, 0.75, 0.75);

  let page = pdfDoc.addPage([PW, PH]);
  let y = PH - M;

  function newPage() {
    page = pdfDoc.addPage([PW, PH]);
    y = PH - M;
  }
  function check(h = LH) { if (y - h < M) newPage(); }

  function sectionHeading(title: string) {
    y -= 10;
    check(24);
    page.drawText(title, { x: M, y, font: fontB, size: 11, color: rgb(0.15, 0.15, 0.15) });
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: lightGray });
    y -= LH;
  }

  function drawField(label: string, value: string) {
    const valW = PW - M - LABEL_W - M;
    const lines = wrapLines(value || "—", fontR, 9.5, valW);
    check(LH * lines.length);
    page.drawText(label, { x: M, y, font: fontB, size: 9, color: gray });
    page.drawText(lines[0], { x: M + LABEL_W, y, font: fontR, size: 9.5, color: black });
    y -= LH;
    for (let i = 1; i < lines.length; i++) {
      check(LH);
      page.drawText(lines[i], { x: M + LABEL_W, y, font: fontR, size: 9.5, color: black });
      y -= LH;
    }
  }

  function drawBullet(text: string) {
    const valW = PW - M - 14 - M;
    const lines = wrapLines(text, fontR, 9.5, valW);
    check(LH * Math.min(lines.length, 3));
    page.drawText("•", { x: M, y, font: fontR, size: 9.5, color: gray });
    page.drawText(lines[0], { x: M + 14, y, font: fontR, size: 9.5, color: black });
    y -= LH;
    for (let i = 1; i < lines.length; i++) {
      check(LH);
      page.drawText(lines[i], { x: M + 14, y, font: fontR, size: 9.5, color: black });
      y -= LH;
    }
  }

  // ─── Title ─────────────────────────────────────────────────────────────────

  page.drawText("LEASE ABSTRACT", { x: M, y, font: fontB, size: 20, color: black });
  y -= 26;
  page.drawText(
    `Source: ${sourceFileName(abstract.source_document)}   ·   Abstracted: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    { x: M, y, font: fontR, size: 9, color: gray },
  );
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
  y -= LH + 4;

  // ─── Core terms ────────────────────────────────────────────────────────────

  sectionHeading("CORE TERMS");
  drawField("Execution Date", formatDate(abstract.execution_date));
  drawField("Expiration Date", formatDate(abstract.expiration_date));
  drawField("Term", abstract.term ?? "—");
  drawField("Base Rate", abstract.base_rate != null ? (formatPsf(abstract.base_rate) ?? "—") : "—");

  // ─── Escalations ───────────────────────────────────────────────────────────

  if (abstract.escalations.length > 0) {
    sectionHeading("ESCALATIONS");
    for (const e of abstract.escalations) {
      drawBullet(`${e.description} — ${e.rate}${e.effective_date ? ` (eff. ${e.effective_date})` : ""}`);
    }
  }

  // ─── Options ───────────────────────────────────────────────────────────────

  if (abstract.options.length > 0) {
    sectionHeading("OPTIONS");
    for (const o of abstract.options) {
      drawBullet(`[${o.type.toUpperCase()}] ${o.description}${o.notice_period ? `  ·  Notice: ${o.notice_period}` : ""}`);
    }
  }

  // ─── Key provisions ────────────────────────────────────────────────────────

  if (abstract.key_provisions.length > 0) {
    sectionHeading("KEY PROVISIONS");
    for (const kp of abstract.key_provisions) {
      drawBullet(kp.provision + (kp.citation ? `  (§${kp.citation})` : ""));
    }
  }

  // ─── Critical dates ────────────────────────────────────────────────────────

  const critDates = buildCriticalDates(abstract);
  if (critDates.length > 0) {
    sectionHeading("CRITICAL DATES");
    for (const d of critDates) {
      drawField(d.label, formatDate(d.date));
    }
  }

  // ─── Citations ─────────────────────────────────────────────────────────────

  if (abstract.field_citations.length > 0) {
    sectionHeading("SOURCE CITATIONS");
    for (const c of abstract.field_citations) {
      const valW = PW - M - LABEL_W - M;
      const excerpt = `p.${c.page}  "${c.text.slice(0, 100)}${c.text.length > 100 ? "…" : ""}"`;
      drawField(c.field, excerpt);
    }
  }

  return pdfDoc.save();
}

// ─── Browser-only download trigger ─────────────────────────────────────────────

export function triggerDownload(data: Uint8Array | string, filename: string, mimeType: string): void {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: mimeType })
      : new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
