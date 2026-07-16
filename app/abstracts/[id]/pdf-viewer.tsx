"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfViewerProps {
  url: string;
  targetPage: number | null;
  highlightText: string | null;
}

export function PdfViewer({ url, targetPage, highlightText }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width for responsive PDF scaling
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setContainerWidth(w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Navigate to cited page when a citation is clicked in the review panel
  useEffect(() => {
    if (targetPage && targetPage >= 1 && numPages > 0 && targetPage <= numPages) {
      setCurrentPage(targetPage);
    }
  }, [targetPage, numPages]);

  const customTextRenderer = useCallback(
    ({ str }: { str: string; itemIndex: number }) => {
      if (!highlightText || !str) return str;
      // Match first 20 chars of citation text (fuzzy — PDFs may wrap words differently)
      const needle = highlightText.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(${needle})`, "gi");
      const matched = str.match(re);
      if (!matched) return str;
      return str.replace(
        re,
        (m) => `<mark style="background:rgba(251,191,36,0.55);border-radius:2px;padding:0 1px;">${m}</mark>`,
      );
    },
    [highlightText],
  );

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setLoadError(false);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* PDF canvas area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto bg-neutral-200 dark:bg-neutral-800 flex justify-center p-3"
      >
        {loadError ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Could not load PDF
          </div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={onLoadSuccess}
            onLoadError={() => setLoadError(true)}
            loading={
              <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                Loading PDF…
              </div>
            }
          >
            <Page
              key={`page-${currentPage}-${highlightText ?? ""}`}
              pageNumber={currentPage}
              width={containerWidth > 0 ? containerWidth - 24 : undefined}
              renderTextLayer
              renderAnnotationLayer={false}
              customTextRenderer={customTextRenderer}
            />
          </Document>
        )}
      </div>

      {/* Page navigation */}
      {numPages > 0 && (
        <div className="flex-none flex items-center justify-between gap-2 border-t bg-background px-3 py-1.5">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className={cn(
              "flex items-center gap-0.5 px-2 py-1 rounded text-sm transition-colors",
              "hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <ChevronLeft className="size-3.5" />
            Prev
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentPage} / {numPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages}
            className={cn(
              "flex items-center gap-0.5 px-2 py-1 rounded text-sm transition-colors",
              "hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            Next
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
