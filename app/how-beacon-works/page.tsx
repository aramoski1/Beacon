import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth-require-user";
import { GUIDE_CATEGORIES, PAGE_GUIDES, REDIRECT_NOTES } from "@/lib/page-guides";

export const metadata = { title: "How Beacon works – Beacon" };

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

function GuideSection({
  guide,
}: {
  guide: (typeof PAGE_GUIDES)[number];
}) {
  return (
    <section id={guide.id} className="scroll-mt-20 space-y-4 border-b border-border pb-10 last:border-0">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {guide.category}
        </p>
        <h2 className="text-base font-semibold tracking-tight mt-1">{guide.title}</h2>
        <p className="text-xs font-mono text-muted-foreground mt-0.5">{guide.route}</p>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{guide.purpose}</p>
      </div>

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
    </section>
  );
}

export default async function HowBeaconWorksPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const supabase = await createClient();
  await requireUser(supabase, { skipPilotAgreement: true });

  const { from } = await searchParams;
  const fromOnboarding = from === "onboarding";
  const fromPilot = from === "pilot";

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-10">
      <div>
        {fromOnboarding ? (
          <Link
            href="/onboarding"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to setup
          </Link>
        ) : fromPilot ? (
          <Link
            href="/pilot-agreement"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Pilot agreement
          </Link>
        ) : (
          <Link
            href="/settings"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Settings
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight mt-4">How Beacon works</h1>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          Beacon is a CRM for South Florida commercial brokers. Three loops matter every morning —
          everything else supports them. Below is a page-by-page guide to every screen in the app.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-tight">Why Beacon</h2>
        <ol className="space-y-4 text-sm leading-relaxed">
          <li>
            <p className="font-medium text-foreground">1. Ownership truth</p>
            <p className="text-muted-foreground mt-0.5">
              Pull parcel owners from the county/state tax roll (Miami-Dade, Broward, Palm Beach;
              Boston-metro Massachusetts), find people behind Florida LLCs on Sunbiz, and promote
              them into your CRM. Enroll key assets on ownership watch so flips don&apos;t surprise you.
            </p>
          </li>
          <li>
            <p className="font-medium text-foreground">2. Lease rollover</p>
            <p className="text-muted-foreground mt-0.5">
              Abstract lease PDFs linked to properties. Lease radar and the Dashboard Today desk
              surface expirations while you still have time to act.
            </p>
          </li>
          <li>
            <p className="font-medium text-foreground">3. Who to call</p>
            <p className="text-muted-foreground mt-0.5">
              Contacts, tiers, and cadence tell you who is overdue. Workspace splits the book into
              Owners and Tenants. Outreach drafts email in your own client (merge fields fill
              name, address, SF, landlord, expiry); Log call / Log tour bumps last-contacted so
              the queue stays honest. Pin a smart list under Advanced → This week for a weekly block.
            </p>
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Day-1 path</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground leading-relaxed">
          <li>
            <span className="text-foreground">Import or add properties</span> — spreadsheet in
            onboarding, address lookup under + New, or Prospect (sentence search or a saved buy
            box) to find off-book owners on the tax roll.
          </li>
          <li>
            <span className="text-foreground">Enrich + promote</span> — county folio, Sunbiz
            contacts, Promote to CRM, set Tier 1 on priorities. County Enrich also queues a
            listing-spec search for empty industrial fields. Miami-Dade Enrich also copies
            named building-card / extra-feature / sketch specs onto those columns (and
            Workspace). On industrial assets, open the property or use Enrich → Find listing
            specs when county left docks or clear height empty.
          </li>
          <li>
            <span className="text-foreground">Abstract leases</span> — upload PDFs linked to a
            property (tenant SF + landlord when the lease states them) so radar can track
            expirations and option-notice dates.
          </li>
          <li>
            <span className="text-foreground">Lease radar + Today desk</span> — work the ranked
            queue on the Dashboard each morning (rollovers, option notices, 1031 deadlines).
          </li>
          <li>
            <span className="text-foreground">Outreach or call</span> — draft → open in email →
            Mark as sent, or Log call on the contact.
          </li>
          <li>
            <span className="text-foreground">Pursue</span> — open a deal when a conversation turns
            into a live requirement.
          </li>
        </ol>
      </section>

      {/* Table of contents */}
      <nav className="rounded-xl border bg-card p-4 space-y-4">
        <h2 className="text-sm font-semibold tracking-tight">Page guides</h2>
        {GUIDE_CATEGORIES.map((cat) => {
          const guides = PAGE_GUIDES.filter((g) => g.category === cat);
          if (guides.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {cat}
              </p>
              <ul className="space-y-1">
                {guides.map((g) => (
                  <li key={g.id}>
                    <a
                      href={`#${g.id}`}
                      className="text-sm text-primary hover:underline underline-offset-4"
                    >
                      {g.title}
                    </a>
                    <span className="text-xs text-muted-foreground ml-1.5 font-mono">{g.route}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Redirects
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {REDIRECT_NOTES.map((r) => (
              <li key={r.route}>
                <span className="font-mono">{r.route}</span> → {r.resolvesTo}
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* All page guides */}
      <div className="space-y-10">
        {PAGE_GUIDES.map((guide) => (
          <GuideSection key={guide.id} guide={guide} />
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Honest limits</h2>
        <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed list-disc list-inside">
          <li>
            Beacon drafts email — you send it from Gmail/Outlook. Merge tokens fill from the
            contact’s property and lease; there is no in-app send.
          </li>
          <li>
            County enrichment covers South Florida (Miami-Dade, Broward, Palm Beach) and the Boston
            metro area (Massachusetts).
          </li>
          <li>
            Comps live on the property page (tax-roll sales, your lease abstracts, and the rent
            notebook) — not live CoStar market data. Tax-roll comps and ownership watch need a
            county folio from Enrich; demo seed rows do not invent one.
          </li>
          <li>
            Industrial / flex specs are on the property page and as Workspace property columns
            (Customize to add/remove fields). Miami-Dade copies a spec from the folio building
            card, extra features, or sketch only when those sources name it — not from DOR, lot
            size, or “wall area above N ft.” Use Find listing specs or a flyer extract when the
            listing states docks or clear height the county omitted. County Enrich, Workspace
            listing enrich, and new-property save also queue that search and fill empty unlocked
            specs. Pages that are clearly not this property's listing are skipped; a URL or paste
            that is not a listing/document for the address is refused.
          </li>
          <li>
            Prospect sentence search only maps to tax-roll filters that exist (city, size, type,
            year, sale, value). It will not search docks, clear height, or “near the airport.” Palm
            Beach is dropped when year/SF is set and you did not name it; Massachusetts cannot
            search by property type alone. Type-only across several markets is too broad — add a
            city or a size/year/sale constraint.
          </li>
          <li>
            Entity/LLC lookup (Sunbiz) is Florida-only — Massachusetts has no equivalent wired up yet.
          </li>
          <li>
            Gmail, Outlook, calendar, and DocuSign connections show status only. Token exchange is
            not wired — Connect is labeled **Connect — not in this build**. Calendar and DocuSign
            do not say Outreach stays Open in email. All tasks is in the main nav. Prospect shows
            the first 100 of a large county hit (not only “narrow your criteria”). Lease radar
            titles the tenant or property and shows tenant SF plus in-place vs market when a
            rent band matches. Dates use the local calendar day.
          </li>
          <li>
            Book-map geocode uses Florida or Massachusetts from the property market or folio. It
            does not assume every address is in Florida.
          </li>
          <li>
            Stuck on where something lives? Ask Copilot on the Dashboard — or use the page guides
            above.
          </li>
        </ul>
      </section>

      <div className="pt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {fromOnboarding ? (
          <Link
            href="/onboarding"
            className="font-medium text-primary hover:underline underline-offset-4"
          >
            Continue setup →
          </Link>
        ) : (
          <>
            <Link
              href="/dashboard"
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Go to Dashboard →
            </Link>
            <Link
              href="/crm"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Open Workspace
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
