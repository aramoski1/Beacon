"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getGuideForPathname, type PageGuide } from "@/lib/page-guides";

function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="text-foreground font-medium">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function PageHelpPanel({ guide, onClose }: { guide: PageGuide; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-3 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-labelledby="page-help-title"
        aria-modal="true"
        className="bg-background rounded-xl border shadow-xl w-full max-w-lg max-h-[min(85vh,42rem)] flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              How this page works
            </p>
            <h2 id="page-help-title" className="text-sm font-semibold tracking-tight mt-0.5">
              {guide.title}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{guide.purpose}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Close help"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4 flex-1">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground mb-2">
              How to use this page
            </h3>
            <ol className="space-y-2 text-sm text-muted-foreground leading-relaxed list-decimal list-inside">
              {guide.walkthrough.map((step, i) => (
                <li key={i} className="pl-1">
                  <RichText text={step} />
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground mb-2">
              Features on this page
            </h3>
            <ul className="space-y-1.5 text-sm text-muted-foreground leading-relaxed list-disc list-inside">
              {guide.features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/how-beacon-works#${guide.id}`}
            onClick={onClose}
            className="text-xs font-medium text-primary hover:underline underline-offset-4"
          >
            Open full guide →
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border hover:bg-muted/50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Floating help button — shows page-specific guide for the current route. */
export function PageHelpButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const guide = getGuideForPathname(pathname);

  if (!guide) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed z-[55] flex items-center justify-center rounded-full border bg-card shadow-md",
          "text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors",
          "size-10",
          pathname.startsWith("/outreach")
            ? "bottom-20 right-4 sm:bottom-6 sm:right-6"
            : "bottom-4 right-4 sm:bottom-5 sm:right-5",
        )}
        aria-label={`How ${guide.title} works`}
        title="How this page works"
      >
        <CircleHelp className="size-5" />
      </button>

      {open && <PageHelpPanel guide={guide} onClose={() => setOpen(false)} />}
    </>
  );
}
