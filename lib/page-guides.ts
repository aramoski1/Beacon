export type PageGuide = {
  id: string;
  route: string;
  title: string;
  category: string;
  purpose: string;
  walkthrough: string[];
  features: string[];
};

export const GUIDE_CATEGORIES = [
  "Getting started",
  "Main navigation",
  "Advanced",
  "Add & import",
  "Record detail pages",
  "Owner portfolio",
  "Settings & team",
  "Admin & access",
] as const;

export const PAGE_GUIDES: PageGuide[] = [
  // ─── Getting started ───────────────────────────────────────────────────────
  {
    id: "login",
    route: "/login",
    title: "Sign in / Sign up",
    category: "Getting started",
    purpose: "Authenticate into Beacon. New accounts are invite-only — your email must be on the approved list.",
    walkthrough: [
      "Open the login page. Use **Sign in** if you already have an account, or **Sign up** to create one.",
      "Enter your email and password (minimum 6 characters on signup).",
      "If signup is blocked with an invite-only message, your email is not approved yet — contact the Beacon admin.",
      "After sign-in you land on **Onboarding** (first time) or the **Dashboard** (returning users). Existing accounts that have not accepted the pilot terms are sent to **Pilot agreement** first.",
    ],
    features: [
      "Sign in and sign up tabs on one page",
      "Invite-only signup — email must be on the approved list",
      "Pilot agreement checkbox required on signup",
      "No confirmation email required — accounts activate immediately when approved",
      "Clear error messages for wrong password or non-approved email",
    ],
  },
  {
    id: "pilot-agreement",
    route: "/pilot-agreement",
    title: "Pilot agreement",
    category: "Getting started",
    purpose: "Accept Beacon’s private-pilot terms before using the CRM. Shown on signup and to existing users who have not accepted yet.",
    walkthrough: [
      "Read the short pilot terms (do not share access or confidential product details outside your firm).",
      "Check the agreement box and click **Accept and continue**.",
      "You can open **How Beacon works** from this screen without losing the gate.",
      "Use **Sign out** if you are not ready to accept.",
    ],
    features: [
      "Required once per account (stored as pilot_agreement_accepted_at)",
      "Blocks Dashboard and other app pages until accepted",
      "Link to How Beacon works",
    ],
  },
  {
    id: "onboarding",
    route: "/onboarding",
    title: "Onboarding (first setup)",
    category: "Getting started",
    purpose: "Import your existing spreadsheet or start with an empty book before the Dashboard unlocks.",
    walkthrough: [
      "**Welcome** — choose **Import my data**, **Skip** (empty CRM), or read **How Beacon works**.",
      "**Upload** — pick Properties or Contacts, drag a CSV/XLSX file, or browse to select.",
      "**Map columns** — Beacon suggests field mappings; adjust any column before importing.",
      "**Import** — wait for deduplication and row counts; fix errors if shown.",
      "**Done** — review summary. Optionally run **Bulk enrich** on imported properties (county + Sunbiz).",
      "Click **Go to CRM** or **Import another file**. Completing onboarding unlocks the Dashboard.",
    ],
    features: [
      "Properties and contacts import from spreadsheet",
      "Column mapping with auto-suggestions",
      "Bulk enrich queue for Florida properties after import",
      "Link to How Beacon works from welcome and done steps",
    ],
  },
  {
    id: "overview",
    route: "/how-beacon-works",
    title: "How Beacon works (this page)",
    category: "Getting started",
    purpose: "Product overview and page-by-page guides for every screen in Beacon.",
    walkthrough: [
      "Read the three core loops: **ownership truth**, **lease rollover**, **who to call**.",
      "Use the table of contents to jump to any page guide below.",
      "Follow the **Day-1 path** for your first week, then dive into individual page guides as needed.",
      "Return here anytime from **Settings** → How Beacon works.",
    ],
    features: [
      "Full walkthrough for every Beacon page",
      "Honest limits (email drafts, county coverage, comps, no invented tax-roll docks)",
      "Linked from Settings and onboarding",
    ],
  },

  // ─── Main navigation ───────────────────────────────────────────────────────
  {
    id: "dashboard",
    route: "/dashboard",
    title: "Dashboard",
    category: "Main navigation",
    purpose: "Your morning command center — ranked priorities, book health, and pipeline snapshot.",
    walkthrough: [
      "Start here each morning. Read the greeting and briefing line at the top.",
      "Use **Ask Beacon** (Copilot) for natural-language questions about your book.",
      "Click **Customize** to show or hide dashboard modules (KPI strip, Today desk, pipeline, etc.).",
      "Work **Do these today** — the ranked queue merges outreach, follow-ups, deals, ownership flips, urgent leases, option-notice deadlines, and 1031 clocks.",
      "Scan KPI chips (pursuits, leases ≤90d, Tier-1 overdue, ownership changes, book size) — each links to the relevant page.",
      "Check secondary panels: pipeline, lease exposure, book composition, cadence health, recent activity.",
    ],
    features: [
      "Today desk — ranked action queue (cap ~12 items), including option notices and 1031 deadlines",
      "KPI strip with links to Deals, Lease radar, Outreach, Workspace",
      "Upcoming follow-ups, ready-to-pursue, cold Tier-1 panels",
      "Lease exposure + compact radar preview",
      "Ownership watch batch button and ownership-changed alerts",
      "Cadence health ring and week momentum",
      "Dashboard layout customization (show/hide modules)",
      "Beacon Copilot search bar",
    ],
  },
  {
    id: "crm",
    route: "/crm",
    title: "Workspace",
    category: "Main navigation",
    purpose: "Your primary grid for properties, contacts, and lease abstracts — search, filter, edit, export, and bulk actions.",
    walkthrough: [
      "Choose a tab: **Properties**, **Contacts**, or **Leases**.",
      "On **Contacts**, switch **All / Owners / Tenants** to work the owner book or tenant book. Tenant rows show occupancy (property, leased SF, expiry, landlord).",
      "If your firm has teammates, toggle **Mine** vs **Firm** to scope which records you see.",
      "Type a plain-English query in **AI search** (e.g. “industrial over 50k SF in Doral”) or switch to **Smart lists** for saved filters.",
      "Apply column filters (type, tier, cadence status, expiration window, etc.).",
      "Click column headers to sort; resize columns; use **Columns** to show/hide fields.",
      "Click a row to open the detail page, or use row actions (Promote, Enrich, Log call, etc.).",
      "Select multiple rows for bulk export or bulk enrich (properties).",
      "Use **+ New** in the sidebar for quick adds, or **Manage fields** to add custom Workspace columns (properties, contacts, or leases).",
      "Industrial specs (clear height, docks, rent, and anything you add) live on the **property detail** card — not as built-in Workspace columns. Add a custom field here if you want one of those on the grid.",
    ],
    features: [
      "Three tabs: Properties, Contacts, Leases",
      "Owner / Tenant book toggle on Contacts (contact_type + occupancy columns)",
      "AI natural-language search with filter explanation",
      "Smart lists — save, load, delete filter presets",
      "Inline grid editing (text, selects, tiers, tags, custom fields)",
      "Pagination (50 rows per page)",
      "Properties: Promote to CRM, county Enhance, owner portfolio, delete",
      "Contacts: Log call, compose email, create deal",
      "Manage fields — broker-defined custom columns only (not industrial specs)",
      "Bulk export XLSX, bulk enrich selected properties",
      "Send selected contacts to Outreach",
      "Firm scope toggle (multi-member firms)",
    ],
  },
  {
    id: "deals",
    route: "/deals",
    title: "Deals (pursuit pipeline)",
    category: "Main navigation",
    purpose: "Track tenant rep, listing, and investment sale pursuits from prospect through close.",
    walkthrough: [
      "Click **New pursuit** (or use sidebar + New → New pursuit).",
      "Search by deal name, contact, company, or property address.",
      "Filter by deal type; sort by updated date, commission, close date, or days in stage.",
      "Switch views: **Kanban** (drag cards between stages), **List** (bulk actions), **Forecast** (commission by month).",
      "Click a card or row to open the deal detail page.",
      "Watch stale indicators — deals sitting too long in one stage.",
    ],
    features: [
      "Deal types: tenant rep, listing, investment sale (different stage sets)",
      "Kanban drag-and-drop between stages",
      "List view with bulk stage change and delete",
      "Forecast view — weighted commission by expected close month",
      "Search and type filter",
      "Custom deal fields via Manage fields",
    ],
  },
  {
    id: "deals-detail",
    route: "/deals/[id]",
    title: "Deal detail",
    category: "Record detail pages",
    purpose: "Single pursuit — terms, linked contact/property, documents, activity, and follow-ups.",
    walkthrough: [
      "Edit name, stage, type, estimated commission, expected close, next action + due date, and notes.",
      "Link or view the associated **contact** and **property**.",
      "Toggle **Share with firm** if teammates should see this pursuit.",
      "Upload documents or click **Download LOI** for a Word draft from deal + property fields.",
      "Log calls, emails, meetings, and notes in Activity.",
      "Add follow-ups with due dates tied to this deal.",
      "Delete the pursuit when closed or abandoned (confirmation required).",
    ],
    features: [
      "Full pursuit editor with type-aware stages",
      "Linked contact and property deep links",
      "Team sharing toggle",
      "Documents upload/download/delete",
      "Activity timeline and follow-ups",
      "Download LOI (Word draft)",
      "Custom fields",
      "Stale stage badge",
    ],
  },
  {
    id: "prospect",
    route: "/prospect",
    title: "Prospect (lead finder)",
    category: "Main navigation",
    purpose: "Search live tax-roll parcel data across four markets and import matches into your book.",
    walkthrough: [
      "Load a saved **buy box** from the dropdown, or set criteria manually.",
      "Pick **markets** (Miami-Dade, Broward, Palm Beach, Massachusetts) and optional cities.",
      "Set size, type, assessed value, year built, sale recency, owner portfolio size, or lease-expiring filters.",
      "Click **Search** — results show owner, SF, sale info, portfolio count, and lease signals.",
      "Select rows (or select all) and click **Accept leads** to import through the enrichment pipeline.",
      "Review the accept summary (created / skipped duplicates / errors).",
      "Save current criteria as a new buy box for repeat searches.",
    ],
    features: [
      "Live GIS search across MD, Broward, PBCPA, Massachusetts",
      "Saveable buy boxes (saved search presets)",
      "Sale recency and owner portfolio size signals",
      "Lease-expiring-soon cross-reference against your abstracts",
      "Accept-to-enrich: county detail + Sunbiz (FL) + zoning on import",
      "Honest caveats for Palm Beach missing fields and MA data limits",
    ],
  },
  {
    id: "lease-radar",
    route: "/lease-radar",
    title: "Lease radar",
    category: "Main navigation",
    purpose: "Lease rollover intelligence — expirations by urgency with tenant vs owner outreach routing.",
    walkthrough: [
      "Read the urgent banner if leases expire within 90 days.",
      "Use count tiles to jump to buckets: **≤90d**, **≤180d**, **≤12mo**.",
      "Expand or collapse buckets (90d open by default; later buckets collapsed).",
      "Each row shows property, days to expiry, option-notice countdown when the abstract has a notice period, WHO to email (tenant or owner), and WHY.",
      "Click **Email tenant** or **Email owner** to generate an AI draft inline.",
      "Edit subject/body, then **Open in email** to send from Gmail/Outlook and log the outreach.",
      "If tenant is missing on the abstract, link them first via the abstract page.",
    ],
    features: [
      "Expiration buckets with sticky headers",
      "Option-notice countdown on rows when the abstract has a notice period",
      "Tenant vs owner routing with switch option when both exist",
      "Inline AI draft generation for rollover outreach",
      "Open in email + mark sent (logs activity)",
      "Links to property, contact, and abstract",
      "Auto-syncs lease-expiry follow-ups",
    ],
  },
  {
    id: "outreach",
    route: "/outreach",
    title: "Outreach",
    category: "Main navigation",
    purpose: "Cadence-driven email queue — select contacts, generate AI drafts, send from your mail client.",
    walkthrough: [
      "Choose **Due now** (cadence overdue/today) or **All contacts**.",
      "Filter by channel: all, has email, or has phone.",
      "Open **Campaign settings** to set your broker context and email template (Intro, Check-in, Market update, Listing alert).",
      "Select contacts by tier section, or use **Select all visible** / **Select all overdue**.",
      "Open **Campaign settings** to set a merge template (`{first_name}`, `{address}`, `{sf}`…) or check **Merge only** to skip AI.",
      "Click **Generate drafts** — large selections process in batches of 10.",
      "On the review step, edit each subject and body.",
      "Click **Open in email ↗** — you send from Gmail/Outlook; Beacon does not auto-send.",
      "Click **Mark as sent** after sending to log outreach and bump last-contacted.",
      "Use **Test mode** to redirect drafts to your own address while testing.",
    ],
    features: [
      "Due vs All list modes",
      "Tier-grouped contact list with show-more pagination",
      "Four email templates",
      "Merge fields from property/lease occupancy ({name}, {address}, {sf}, {landlord}, {expiry})",
      "Broker context field (saved locally)",
      "Batch draft generation (10 per batch)",
      "Review and edit step before sending",
      "Open in email (Gmail, Outlook, M365, mailto)",
      "Mark as sent / mark all as sent",
      "Test mode",
      "Pre-selection from CRM bulk action or ?contact= deep link",
    ],
  },

  // ─── Advanced ──────────────────────────────────────────────────────────────
  {
    id: "follow-ups",
    route: "/follow-ups",
    title: "All tasks (follow-ups)",
    category: "Advanced",
    purpose: "Open task list — manual follow-ups and auto-created lease-expiry tasks.",
    walkthrough: [
      "Scan **Overdue**, **Due today**, and **Upcoming** sections (Upcoming collapses when urgent items exist).",
      "Click the checkbox to **mark done** on any task.",
      "Click the mail icon to compose outreach inline when a contact is linked.",
      "Click **Add follow-up** — enter description, due date, and link a contact or property.",
      "Toggle **Show completed** to review finished tasks.",
      "Follow lease-expiry tasks back to the abstract via the Lease badge.",
    ],
    features: [
      "Overdue / Due today / Upcoming buckets with collapsible headers",
      "Mark done with one click",
      "Inline compose outreach per row",
      "Lease-expiry badge on auto-generated tasks",
      "Add follow-up form with contact/property links",
      "Show completed toggle",
    ],
  },
  {
    id: "week",
    route: "/week",
    title: "This week",
    category: "Main navigation",
    purpose: "Work a pinned contact segment this week — log calls and email without leaving the list.",
    walkthrough: [
      "Open **This week** in the main nav. Pin a **Contacts** smart list (Owners book, Tenants book) and set how many people to work.",
      "If no list is pinned, Beacon falls back to cadence-due contacts in the next 7 days.",
      "Work down the list: call, **Log** (Connected / Left VM / No answer), or compose email.",
      "Click **Generate drafts** to mail-merge the whole list in Outreach.",
    ],
    features: [
      "Pin a contact smart list as this week’s work block",
      "Progress (worked this week / list size)",
      "Generate drafts for the whole list (mail merge)",
      "Call outcome picker + tel: link",
      "Fallback to cadence due in 7 days when nothing is pinned",
    ],
  },
  {
    id: "tours",
    route: "/tours",
    title: "Tours",
    category: "Advanced",
    purpose: "Schedule property tours with attendees and prep notes.",
    walkthrough: [
      "Pick date/time, optional property and contact, attendees, and prep notes.",
      "Click **Save tour**. Upcoming tours show at the top.",
      "**Mark done** after the visit, or **Cancel** if it does not happen.",
      "Calendar sync stays off until you connect Google or Outlook under Settings → Connections.",
    ],
    features: [
      "Scheduled / completed / cancelled statuses",
      "Links to property and contact",
      "Prep notes and post-tour notes field",
    ],
  },
  {
    id: "book-map",
    route: "/book-map",
    title: "Book map",
    category: "Advanced",
    purpose: "Corridor view plus a pin map of geocoded properties.",
    walkthrough: [
      "Open **Pin map** to see geocoded assets on OpenStreetMap.",
      "Click **Geocode missing pins** to store lat/lng (Nominatim, ~1s per address).",
      "Switch to **Corridors** for submarket/city buckets with SF and type filters.",
      "Click a pin or corridor row to open the property.",
    ],
    features: [
      "Pin map (Leaflet + OSM tiles)",
      "Nominatim geocode stored on the property",
      "Submarket/city corridor aggregation",
      "SF and type filters",
    ],
  },
  {
    id: "audit",
    route: "/properties/audit",
    title: "Data audit",
    category: "Advanced",
    purpose: "Find bad imports before they pollute outreach and comps.",
    walkthrough: [
      "Review flagged properties: default bad addresses, government owners, missing core fields.",
      "Read the reason badge on each row.",
      "Open the property to fix data, or **Delete** junk records from the audit list.",
      "Use summary counts by issue type to prioritize cleanup.",
    ],
    features: [
      "Flags: bad default address, government owner, missing address/owner/SF",
      "Per-row reason badges",
      "Delete from audit list",
      "Summary counts by issue type",
    ],
  },
  {
    id: "ingestion-errors",
    route: "/properties/errors",
    title: "Ingestion errors",
    category: "Advanced",
    purpose: "Log of failed address lookups, URL imports, and file uploads.",
    walkthrough: [
      "Browse paginated errors with source (address, URL, upload), stage, and timestamp.",
      "Expand a row for full error detail.",
      "Dismiss individual errors after fixing or ignoring.",
      "Use **Clear all** to wipe the log.",
    ],
    features: [
      "Source and pipeline stage per error",
      "Expandable detail",
      "Dismiss individual or clear all",
      "Also linked from Settings → Data & Sources",
    ],
  },

  // ─── Add & import ──────────────────────────────────────────────────────────
  {
    id: "properties-new",
    route: "/properties/new",
    title: "Add property",
    category: "Add & import",
    purpose: "Add a property via county address lookup, listing URL, or file upload.",
    walkthrough: [
      "Choose a method tab: **Address lookup**, **From URL**, or **Upload file**.",
      "**Address:** enter address → pick folio candidate → preview tax-roll data → select Sunbiz people → **Save to database**.",
      "**URL:** paste a listing URL (or page text) → AI extracts fields including industrial specs when the listing states them → review preview → save.",
      "**Upload:** drop PDF/image/spreadsheet or paste text → AI extracts fields including industrial specs when the source states them → review → save.",
      "Fill any manual custom fields on the preview before saving. County tax roll will not invent docks or clear height.",
      "If Sunbiz auto-lookup fails, use the manual Sunbiz search link.",
    ],
    features: [
      "County lookup: Miami-Dade, Broward, Palm Beach, Massachusetts",
      "URL ingest with AI extraction (Jina + Claude)",
      "File upload ingest (PDF, image, spreadsheet)",
      "Sunbiz owner people selection on save",
      "Preview with confidence flags",
      "Custom extract fields on preview",
    ],
  },
  {
    id: "contacts-new",
    route: "/contacts/new",
    title: "Add contact",
    category: "Add & import",
    purpose: "Manually add an owner or tenant contact to your CRM.",
    walkthrough: [
      "Choose **Book**: Owner, Tenant, or Other — required so the contact lands on the right Workspace view.",
      "Enter identity: name, company, title, email, phones, mailing address.",
      "Set ownership role, asset focus tags, submarket, and portfolio size.",
      "Assign relationship tier (1–3), stage, and lead source.",
      "Optionally pre-link to a property (from property detail → Add contact).",
      "Fill custom fields and save — opens contact detail or returns to property.",
    ],
    features: [
      "Required book (owner / tenant / other)",
      "Full CRE contact profile fields",
      "Optional property pre-link via URL params",
      "Custom fields",
      "Tier and relationship stage",
    ],
  },
  {
    id: "abstracts-new",
    route: "/abstracts/new",
    title: "Abstract lease",
    category: "Add & import",
    purpose: "Upload lease PDF(s) and extract a structured abstract linked to a property.",
    walkthrough: [
      "Choose **Single** or **Batch** upload mode.",
      "Drop or select a lease PDF — AI extracts terms, rates, dates, tenant SF, landlord, escalations, options.",
      "**Link to property** (required) — powers Lease radar and Today desk.",
      "Optionally assign tenant contact from property contacts.",
      "Review extracted fields and custom lease fields.",
      "Click **Save to database**. Batch mode processes multiple PDFs in sequence.",
    ],
    features: [
      "Single and batch PDF upload",
      "AI lease abstraction (Claude)",
      "Tenant SF (leased_sf) and landlord name on the abstract",
      "Required property link",
      "Tenant contact assignment",
      "Custom lease fields from extraction",
    ],
  },

  // ─── Record detail pages ───────────────────────────────────────────────────
  {
    id: "property-detail",
    route: "/properties/[id]",
    title: "Property detail",
    category: "Record detail pages",
    purpose: "Everything Beacon knows about one asset — tax roll, enrichment, owners, comps, activity.",
    walkthrough: [
      "Review core fields: address, type, SF, land, sale history, assessed value, folio source.",
      "Use **Enrich** to re-run county data, Sunbiz lookup, CoStar owner or tenant file parse, or URL re-ingest.",
      "Enroll on **ownership watch** and run **Check ownership now** for flip detection.",
      "Read **Zoning**. On **Industrial / flex specs**, click **Customize** to delete defaults or add any spec you track (same idea as custom fields).",
      "Listing/document extract fills those specs only when the source states them — county tax roll will not invent docks or clear height.",
      "Promote Sunbiz people to CRM contacts; open **owner portfolio** for sibling parcels.",
      "View **tax-roll comps**, **lease comps**, and the **rent notebook** (seed bands + your comps).",
      "Link/unlink contacts; upload documents; log activity and follow-ups.",
      "Toggle **Share with firm** or **Create pursuit** from the header.",
    ],
    features: [
      "County enrichment and Sunbiz owner lookup",
      "Ownership watch enroll + batch re-check",
      "Ownership change alerts",
      "Zoning/FAR from county sources",
      "Industrial / flex specs — customizable defaults; extract when stated",
      "Rent notebook (seed bands + your comps)",
      "Tax-roll sale comps and lease comps",
      "Promote owners to contacts",
      "CoStar owner or tenant file parse (book picker)",
      "Linked contacts management",
      "Documents, activity, follow-ups",
      "Team sharing and create deal",
      "Custom fields",
    ],
  },
  {
    id: "contact-detail",
    route: "/contacts/[id]",
    title: "Contact detail",
    category: "Record detail pages",
    purpose: "Relationship hub — cadence, outreach, linked properties, pursuits, and activity.",
    walkthrough: [
      "Check cadence status at the top — overdue, on track, days since last contact.",
      "Use quick actions: **Email**, **Log call**, **Log tour**, **Log activity**, **Add note**, **Set follow-up**.",
      "Pick a call outcome: Connected, Left VM, No answer — bumps last-contacted.",
      "Read the **relationship briefing** (AI summary) when available.",
      "Manage **linked properties** — view, add, remove links.",
      "Edit CRE profile and **Buyer / 1031 criteria** (cap rate, markets, 1031 deadline). Deadlines within 90 days also appear on the Today desk.",
      "On tenant contacts, read the **Occupancy** card (leased SF, landlord, expiry) when an abstract is linked.",
      "Review outreach history and activity timeline.",
      "Open **owner portfolio** when this contact is a property owner.",
      "Create a pursuit or share with firm from the header.",
    ],
    features: [
      "Cadence status and tier display",
      "Quick actions: email, call, tour, note, follow-up",
      "Call outcome chips",
      "AI relationship briefing",
      "Linked properties panel",
      "CRE profile inline edit",
      "Buyer / 1031 criteria (also surfaced on Today desk when due)",
      "Tenant occupancy card (leased SF, landlord, expiry)",
      "Documents and custom fields",
      "Activity timeline + outreach history",
      "Owner portfolio link",
      "Pursuit nudge after enough touches",
      "Team sharing",
    ],
  },
  {
    id: "abstract-detail",
    route: "/abstracts/[id]",
    title: "Lease abstract detail",
    category: "Record detail pages",
    purpose: "Review and correct AI-extracted lease terms against the source PDF.",
    walkthrough: [
      "Read the PDF side-by-side with extracted fields.",
      "For each field, choose **Accept**, **Reject**, or **Correct** — citations jump to the PDF location.",
      "Use **Accept all pending** to speed through clean extractions.",
      "Edit expiration date, base rate, tenant SF, landlord, term, escalations, options, and key provisions.",
      "Link or change the **property** (required for radar) and **assign tenant contact**.",
      "Toggle team sharing; upload related documents.",
      "Corrections save to real database columns (expiration_date, base_rate, etc.).",
    ],
    features: [
      "PDF viewer with field citations",
      "Per-field accept/reject/correct workflow",
      "Accept all pending",
      "Property and tenant contact linking",
      "Field review progress tracker",
      "Team sharing",
      "Documents section",
    ],
  },

  // ─── Owner portfolio ───────────────────────────────────────────────────────
  {
    id: "owner-portfolio-property",
    route: "/owner-portfolio/property/[id]",
    title: "Owner portfolio (from property)",
    category: "Owner portfolio",
    purpose: "Aggregated view of an owner entity's holdings anchored from a property.",
    walkthrough: [
      "Read portfolio summary: property count, total SF, entity/person name.",
      "Review **attention flags** — expiring leases, recent sales, stale outreach.",
      "Browse all properties in the portfolio with links to detail pages.",
      "See upcoming lease expirations across the portfolio.",
      "Explore the **ownership network** (related LLCs/people from Sunbiz).",
      "Run **Tax-roll discovery** to find sibling parcels by owner name in county GIS.",
      "Compose outreach to the primary contact or open their contact record.",
    ],
    features: [
      "Portfolio summary metrics",
      "Attention flags across holdings",
      "Property list with SF, type, sale dates",
      "Lease expiration rollup",
      "Ownership network graph",
      "Tax-roll portfolio discovery (MD + Broward)",
      "Compose outreach to primary contact",
      "Activity timeline across portfolio",
    ],
  },
  {
    id: "owner-portfolio-contact",
    route: "/owner-portfolio/contact/[id]",
    title: "Owner portfolio (from contact)",
    category: "Owner portfolio",
    purpose: "Same portfolio view anchored from a contact — all properties tied to that owner.",
    walkthrough: [
      "Same features as property-anchored portfolio; back link goes to the contact.",
      "Use when you opened portfolio from a contact record rather than a property.",
      "Run tax-roll discovery to expand holdings beyond what's already in your book.",
    ],
    features: [
      "Identical portfolio panels as property-anchored view",
      "Back navigation to contact detail",
      "Tax-roll discovery and import siblings",
    ],
  },

  // ─── Settings & team ───────────────────────────────────────────────────────
  {
    id: "settings",
    route: "/settings",
    title: "Settings",
    category: "Settings & team",
    purpose: "Account, brokerage profile, data sources, outreach cadence, exports, appearance, and account management.",
    walkthrough: [
      "**Account** — set display name, change password, sign out, or delete account (type DELETE).",
      "**Brokerage** — company, license, default market, phone, website (used in email signatures).",
      "**Data & Sources** — county/Sunbiz status, CoStar toggle, links to ingestion and app error logs.",
      "**Outreach** — sender name/email, email client (Gmail/Outlook/M365), signature preview, cadence days per tier.",
      "**Connections** — Gmail/Outlook send, calendar, DocuSign (stubs until OAuth env vars are set).",
      "**Data Management** — download full XLSX exports (properties, contacts, leases).",
      "**Appearance** — light or dark theme.",
      "**Danger Zone** — delete all CRM data (keeps login; type DELETE).",
      "Open **Team** for firm invites, or **How Beacon works** for page guides.",
    ],
    features: [
      "Display name (powers Dashboard greeting)",
      "Password change and sign out",
      "Delete account vs delete all data",
      "Brokerage and signature fields",
      "Email provider preference",
      "Cadence tier day intervals",
      "Connections (OAuth stubs until env vars are set)",
      "CoStar upload toggle",
      "Full book XLSX exports",
      "Light/dark theme",
      "Links to Team, errors, How Beacon works",
    ],
  },
  {
    id: "settings-team",
    route: "/settings/team",
    title: "Team",
    category: "Settings & team",
    purpose: "Firm membership — invite teammates, manage roles, share records.",
    walkthrough: [
      "View your firm name and member list with roles (owner, admin, member).",
      "Click **Invite teammate** — enter email; they receive a join link.",
      "Revoke or resend pending invitations.",
      "Change member roles or remove members (owners/admins).",
      "Leave the firm if you are not the owner.",
      "Sharing records: on any property/contact/deal detail, toggle **Share with firm**.",
      "In Workspace, use **Mine** vs **Firm** scope to browse shared records.",
    ],
    features: [
      "Invite by email with join link",
      "Role management (owner/admin/member)",
      "Revoke/resend invitations",
      "Remove members / leave firm",
      "Per-record team sharing (opt-in, not automatic)",
      "Workspace Mine vs Firm scope",
    ],
  },
  {
    id: "settings-errors",
    route: "/settings/errors",
    title: "App error log",
    category: "Settings & team",
    purpose: "Server-side error log for debugging — not ingestion errors.",
    walkthrough: [
      "Filter **Unresolved** vs **All** errors.",
      "Expand a row for stack trace and context.",
      "Resolve or dismiss individual errors.",
      "Use bulk **Resolve all** or **Dismiss all** after triage.",
    ],
    features: [
      "Unresolved vs all filter",
      "Expandable stack/context",
      "Resolve and dismiss actions",
      "Bulk resolve/dismiss",
      "Pagination",
    ],
  },

  // ─── Admin & access ────────────────────────────────────────────────────────
  {
    id: "admin",
    route: "/admin",
    title: "Admin (access management)",
    category: "Admin & access",
    purpose: "Invite-only gate — manage approved emails, review access requests, and account roster. Admin users only.",
    walkthrough: [
      "Review **Pending access requests** from blocked signup attempts — Approve or Dismiss.",
      "Manage **Approved emails** — add or remove addresses allowed to sign up.",
      "Browse the **Accounts** table — all registered users (identity only, no book data).",
      "Open an account to **revoke** or **restore** access.",
      "Non-admin users are redirected to the Dashboard if they visit /admin.",
    ],
    features: [
      "Approved email allowlist CRUD",
      "Access request queue",
      "Account roster (email, name, firm, status)",
      "Revoke/restore user access",
      "No visibility into user CRM data",
    ],
  },
  {
    id: "join",
    route: "/join/[token]",
    title: "Join firm (invitation)",
    category: "Admin & access",
    purpose: "Accept a team invitation to join a firm.",
    walkthrough: [
      "Open the invitation link from email.",
      "If not signed in, log in or sign up with the **invited email address**.",
      "Review firm name and your assigned role.",
      "Click **Accept invitation** to join.",
      "Joining does not expose your existing private records to teammates automatically.",
    ],
    features: [
      "Token-based invitation acceptance",
      "Email must match invitation",
      "Shows firm name and role",
      "Private-by-default data after joining",
    ],
  },
  {
    id: "access-revoked",
    route: "/access-revoked",
    title: "Access revoked",
    category: "Admin & access",
    purpose: "Shown when an admin has revoked your Beacon access.",
    walkthrough: [
      "Read the message explaining access was revoked.",
      "Click **Back to sign in** to return to the login page.",
      "Contact the Beacon admin if you believe this is an error.",
    ],
    features: [
      "Clear revoked-access message",
      "Link back to login",
      "No in-app navigation",
    ],
  },
];

/** Redirect-only routes — document where they land. */
export const REDIRECT_NOTES: { route: string; resolvesTo: string }[] = [
  { route: "/abstracts", resolvesTo: "/crm?tab=leases" },
  { route: "/contacts", resolvesTo: "/crm?tab=contacts" },
  { route: "/properties/upload", resolvesTo: "/properties/new?method=upload" },
  { route: "/properties/url", resolvesTo: "/properties/new?method=url" },
  { route: "/settings/fields", resolvesTo: "/settings (custom fields via Workspace → Manage fields)" },
  { route: "/", resolvesTo: "/dashboard (when signed in) or /login" },
];

const GUIDE_BY_ID = new Map(PAGE_GUIDES.map((g) => [g.id, g]));

/** Resolve the page guide for the current pathname (including redirects). */
export function getGuideForPathname(pathname: string): PageGuide | null {
  const g = (id: string) => GUIDE_BY_ID.get(id) ?? null;

  if (pathname === "/login") return g("login");
  if (pathname === "/pilot-agreement") return g("pilot-agreement");
  if (pathname === "/onboarding") return g("onboarding");
  if (pathname === "/how-beacon-works") return g("overview");
  if (pathname === "/dashboard" || pathname === "/") return g("dashboard");
  if (pathname === "/crm") return g("crm");
  if (pathname === "/deals") return g("deals");
  if (pathname.startsWith("/deals/")) return g("deals-detail");
  if (pathname === "/prospect") return g("prospect");
  if (pathname === "/lease-radar") return g("lease-radar");
  if (pathname === "/outreach") return g("outreach");
  if (pathname === "/follow-ups") return g("follow-ups");
  if (pathname === "/week") return g("week");
  if (pathname === "/tours") return g("tours");
  if (pathname === "/book-map") return g("book-map");
  if (pathname === "/properties/audit") return g("audit");
  if (pathname === "/properties/errors") return g("ingestion-errors");
  if (pathname === "/properties/new" || pathname === "/properties/upload" || pathname === "/properties/url") {
    return g("properties-new");
  }
  if (pathname.startsWith("/properties/")) return g("property-detail");
  if (pathname === "/contacts") return g("crm");
  if (pathname === "/contacts/new") return g("contacts-new");
  if (pathname.startsWith("/contacts/")) return g("contact-detail");
  if (pathname === "/abstracts") return g("crm");
  if (pathname === "/abstracts/new") return g("abstracts-new");
  if (pathname.startsWith("/abstracts/")) return g("abstract-detail");
  if (pathname.startsWith("/owner-portfolio/property/")) return g("owner-portfolio-property");
  if (pathname.startsWith("/owner-portfolio/contact/")) return g("owner-portfolio-contact");
  if (pathname === "/settings" || pathname === "/settings/fields") return g("settings");
  if (pathname === "/settings/team") return g("settings-team");
  if (pathname === "/settings/errors") return g("settings-errors");
  if (pathname === "/admin") return g("admin");
  if (pathname.startsWith("/join/")) return g("join");
  if (pathname === "/access-revoked") return g("access-revoked");

  return null;
}
