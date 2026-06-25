import { cn } from "@/lib/utils";

export function sourceLabel(source: string | null, sourceUrl?: string | null): string {
  if (sourceUrl?.startsWith("mdpa:")) return "Tax roll";
  if (source === "tax_roll") return "Tax roll";
  if (source === "url") return "URL";
  if (source === "upload") return "Upload";
  if (source === "manual") return "Manual";
  return source ?? "Unknown";
}

export function SourceChip({
  source,
  sourceUrl,
  className,
}: {
  source: string | null;
  sourceUrl?: string | null;
  className?: string;
}) {
  const label = sourceLabel(source, sourceUrl);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize",
        className,
      )}
    >
      {label}
    </span>
  );
}
