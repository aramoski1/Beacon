"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileText, Sheet, FileType2, Calendar, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildWordBytes, buildExcelBytes, buildPdfBytes, buildIcsString,
  triggerDownload, sourceFileName,
  type LeaseAbstractExport,
} from "@/lib/lease-export";

type Format = "docx" | "xlsx" | "pdf" | "ics";

const FORMATS: { id: Format; label: string; ext: string; icon: React.ElementType; mime: string; separator?: boolean }[] = [
  { id: "docx", label: "Word (.docx)", ext: "docx", icon: FileText, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { id: "xlsx", label: "Excel (.xlsx)", ext: "xlsx", icon: Sheet, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { id: "pdf",  label: "PDF (.pdf)",   ext: "pdf",  icon: FileType2, mime: "application/pdf" },
  { id: "ics",  label: "Calendar (.ics)", ext: "ics", icon: Calendar, mime: "text/calendar;charset=utf-8", separator: true },
];

interface ExportMenuProps {
  abstract: LeaseAbstractExport;
}

export function ExportMenu({ abstract }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function handleExport(fmt: Format) {
    setOpen(false);
    setError(null);
    setLoading(fmt);
    const base = sourceFileName(abstract.source_document).replace(/\.pdf$/i, "");
    try {
      if (fmt === "docx") {
        const bytes = await buildWordBytes(abstract);
        triggerDownload(bytes, `${base}-abstract.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      } else if (fmt === "xlsx") {
        const bytes = buildExcelBytes(abstract);
        triggerDownload(bytes, `${base}-abstract.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      } else if (fmt === "pdf") {
        const bytes = await buildPdfBytes(abstract);
        triggerDownload(bytes, `${base}-abstract.pdf`, "application/pdf");
      } else {
        const ics = buildIcsString(abstract);
        if (!ics) {
          setError("No critical dates found to export.");
          return;
        }
        triggerDownload(ics, `${base}-critical-dates.ics`, "text/calendar;charset=utf-8");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={loading !== null}
        className={cn(
          "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors",
          "bg-background hover:bg-accent border-border disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Download className="size-3.5" />
        )}
        Export
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>

      {error && (
        <p className="absolute right-0 top-full mt-1 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1 whitespace-nowrap z-50">
          {error}
        </p>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-md border bg-popover shadow-md py-1">
          {FORMATS.map(({ id, label, icon: Icon, separator }) => (
            <div key={id}>
              {separator && <div className="my-1 border-t border-border" />}
              <button
                onClick={() => handleExport(id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
              >
                <Icon className="size-3.5 text-muted-foreground shrink-0" />
                {label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
