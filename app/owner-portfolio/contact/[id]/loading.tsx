import { PortfolioSkeleton } from "@/app/owner-portfolio/portfolio-skeleton";

export default function Loading() {
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 max-w-2xl mx-auto">
      <PortfolioSkeleton />
    </div>
  );
}
