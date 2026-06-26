import Link from "next/link";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { ownerPortfolioHref } from "@/lib/owner-portfolio";

export function OwnerPortfolioLink({
  contactId,
  propertyId,
  personIndex,
  className,
  label = "View portfolio",
}: {
  contactId?: string;
  propertyId?: string;
  personIndex?: number;
  className?: string;
  label?: string;
}) {
  const href = contactId
    ? ownerPortfolioHref({ type: "contact", contactId })
    : propertyId
      ? ownerPortfolioHref({ type: "property", propertyId, personIndex })
      : null;

  if (!href) return null;

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline underline-offset-2 transition-colors",
        className,
      )}
    >
      <Layers className="size-3.5 shrink-0" />
      {label}
    </Link>
  );
}
