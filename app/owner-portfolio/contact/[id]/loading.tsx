import { PortfolioSkeleton } from "@/app/owner-portfolio/portfolio-skeleton";

export default function Loading() {
  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <PortfolioSkeleton />
    </div>
  );
}
