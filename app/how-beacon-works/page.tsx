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
              Contacts, tiers, and cadence tell you who is overdue. Outreach drafts email in your
              own client; Log call / Log tour bumps last-contacted so the queue stays honest.
            </p>
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Day-1 path</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground leading-relaxed">
          <li>
            <span className="text-foreground">Import or add properties</span> — spreadsheet in
            onboarding, address lookup under + New, or Prospect lead finder.
          </li>
          <li>
            <span className="text-foreground">Enrich + promote</span> — county folio, Sunbiz
            contacts, Promote to CRM, set Tier 1 on priorities.
          </li>
          <li>
            <span className="text-foreground">Abstract leases</span> — upload PDFs linked to a
            property so radar can track expirations.
          </li>
          <li>
            <span className="text-foreground">Lease radar + Today desk</span> — work the ranked
            queue on the Dashboard each morning.
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
          <li>Beacon drafts email — you send it from Gmail/Outlook.</li>
          <li>
            County enrichment covers South Florida (Miami-Dade, Broward, Palm Beach) and the Boston
            metro area (Massachusetts).
          </li>
          <li>Comps come from tax-roll sales and your own lease abstracts — not CoStar market data.</li>
          <li>
            Entity/LLC lookup (Sunbiz) is Florida-only — Massachusetts has no equivalent wired up yet.
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
