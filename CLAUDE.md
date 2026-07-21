@AGENTS.md

# RPS Maintenance & Asset Tracker — Project Context
_Last updated: 2026-07-05_

---

## What this is
Internal fleet and shop operations platform for **Rappahannock Petroleum Services (RPS)** — Trae's father's company, a 40-year UST/fueling business (clients include 7-Eleven, Wawa, Sheetz). Replaces RPS's structured Gmail-based workflows with a unified app, gradually.

**Strategy:** Mirror the email workflow first (read emails → populate dashboard) so no habits change, then transition to app-native input over time. Trae's father is change-averse — demos and messaging always emphasize continuity, never disruption.

**Trae is not a coder.** Claude Code is the pair programmer. Claude.ai handles planning/architecture/content/strategy.

---

## Key people
| Person | Role |
|--------|------|
| Trae's father | Owner; authorizes project; change-averse |
| Trae's brother | Estimating — "RPS Intelligence" concept NOT approved, NOT built, treat as nonexistent |
| Starsky Dodson | Construction Manager; signs all quotes and invoices |
| Gina Jaimes | Contact at JF Petroleum Group |

**Crew tracked by initials** (not full profiles): EL, JF, TW, RM, TJD, CLS, TB, JBS, GB, DL, MNB, etc.

---

## Tech stack
| Component | Detail |
|-----------|--------|
| Framework | Next.js **16.2.6** (NOT 14 — ignore any Next.js 14 references) |
| UI | React 19.2.4, TypeScript, Tailwind CSS 4, shadcn 4 / @base-ui |
| Database | Supabase (PostgreSQL, Auth, Storage, RLS) |
| Deployment | Vercel |
| Middleware | Next.js 16 renamed `middleware.ts` → **`proxy.ts`** — always use proxy.ts |
| MCP | Supabase MCP for direct DB inspection and data loading |

**Always read AGENTS.md before writing any Next.js code** — Next.js 16 breaking changes are documented there.

---

## Supabase
- **Project:** `rps-maintenance`, ID: `zktmhxheouwbyupeizjq`
- **Company ID:** `SELECT id FROM companies ORDER BY created_at LIMIT 1`
- **Construction tables** use `con_` prefix: `con_customers`, `con_sites`, `con_jobs`, `con_quotes`, `con_quote_line_items`, `con_invoices`, `con_invoice_line_items`, `con_schedule_entries`
- DB prepped for Gmail sync: `gmail_imports` table, `repair_tickets.gmail_message_id` / `gmail_thread_id`, `mileage source = 'fuel_receipt'`, `ticket source = 'gmail'`
- `con_schedule_entries.crew` is `text[]` — requires `ARRAY['EL','JF']::text[]`
- Use `LIKE 'SITENUMBER%' ORDER BY created_at LIMIT 1` for partial site matching
- Escape single quotes in text values
- **DOT fields still in schema** (`assets.dot_inspection_due_date`, DOT `maintenance_type` seed row) — pending removal, deferred until after demo

---

## Current state (app is PARTIALLY LIVE — not greenfield)
Phase 1 near-complete, deployed on Vercel.

**Live and verified:**
- Google OAuth login; routes protected via proxy.ts
- Asset management: photos, status, mileage, oil/brake/tire records
- Maintenance-due buckets: overdue / due today / due this week / due next two weeks / due this month
- Repair tickets with live labor timer
- Shop clock in/out with status selectors and manager time approval
- Payroll and expenses CSV exports
- Notifications: overdue maintenance, assets down, forgot-to-clock-out (with dedup)
- Auto-ticket generation for overdue maintenance
- Mobile PWA screens
- Expenses, fuel, payment methods modules
- Construction module: 4 customers, 40 sites, 75 jobs across pipeline stages, quotes, invoices, crew schedule entries

**Only major unbuilt feature:** Gmail/email sync automation (Gmail API + parser + review queue → auto-create clock-ins, labor entries, tickets, mileage, trailer logs, receipts). Consider moving earlier than Phase 2 — strategic to adoption.

**Stale references — ignore:**
- Any "CURRENT STATUS: Ready to begin Step 1" — outdated
- Any reference to Next.js 14
- "RPS Intelligence" / CostIQ module — not approved, not built, treat as nonexistent

---

## Gmail inbox structure (strict enforced formats — parser needs no fuzzy logic)
| Inbox | Purpose | Format |
|-------|---------|--------|
| rptrucklog@gmail.com | Time/labor | One thread per employee per day; subject = date + initials; replies log tasks and status changes; EOD/EOW closing format |
| eshoptasks@gmail.com | Shop repair tickets | Incoming issue = open ticket; shop replies in same thread; not archived until complete |
| maintenancereceipt@gmail.com | Receipts | Subject: total - payment type/acct - site or asset - description |
| Constructionreceipts@gmail.com | Construction receipts | Same subject format as above |
| rptrailerlog@gmail.com | Trailer logs | Subject: initials + pulling asset + date + trailer number; body = "out" or "in" |
| Fuel emails | Fuel logs | Truck/equipment number, mileage, gallons, oil level — mileage drives maintenance-due engine |
| Service completion emails | Service records | State inspection date, tag renewal date, total mileage to next service |

---

## Domain rules (locked)
- **No DOT references anywhere** — RPS does NOT do DOT inspections. Remove all DOT schema fields, UI labels, maintenance categories, dashboard columns
- **Inspection due date = "Service Inspection"** everywhere in UI
- Construction customers: 7-Eleven, Sunoco LP, JF Petroleum Group, Jefferson County Schools

---

## On the horizon
- **Gmail ingestion layer:** Gmail API + parser → auto-populate dashboard from existing inboxes without changing employee behavior. Main complexity: threading logic (new ticket vs. thread reply, dedup by thread ID)
- **DOT cleanup:** remove `assets.dot_inspection_due_date` and DOT `maintenance_type` seed row; relabel all inspection UI as "Service Inspection" — deferred until after demo
- **Multi-employee clock-in:** per-employee time tracking within a shared ticket, separate hour calcs, per-employee display in reports
- **v0.dev:** complete demo first; nothing merged to live app until after demo; Claude Code reviews any v0 PRs before merge

---

## DB / data loading rules
- **Direct DB writes preferred** — load data into live Supabase via MCP, not seed SQL for Trae to run manually
- **Break large inserts by table** — separate `execute_sql` calls per table beat one big DO block
- Escape single quotes in text; use `ARRAY[...]::text[]` for text array columns

---

## Demo / messaging strategy
- Open with one high-value concrete item (e.g., overdue trucks flagged automatically) — not a full feature walkthrough
- Emphasize the app reads existing email — no habit changes for crew
- Never frame current workflows as inadequate
- Say **"page/screen"** not "system/platform"
- Say **"on top of your email"** not "instead of email"
- Tone with Trae's father: casual and relational, not technical

---

## Workflow preferences
- **Two-tool workflow:** Claude.ai for planning/architecture/content/strategy; Claude Code for file writing, commands, direct DB/repo operations
- CLAUDE.md is the persistent context bridge across Claude Code sessions — keep it updated
- Cautious deployment: nothing merged to live app without review, especially before demos
- Output: copy-ready, plain English, concise, direct
- Do not overbuild — master existing features before expanding

---

## Role-based access
Owner/Admin, Manager, Shop Manager, Shop Employee, Read-only Viewer

## Status colors
- Green: good | Yellow: coming due | Orange: due soon | Red: overdue/unsafe | Gray: inactive
> AGENTS.md (imported above) is critical: this app runs on Next.js 16 + React 19,
> which have breaking changes from older versions. Read node_modules/next/dist/docs/
> before writing any Next.js code. Middleware is renamed to "proxy" (see proxy.ts).

---

## WHO THIS IS FOR

Built for Trae's father's company — RPS (Rappahannock Petroleum).
Trae is the project owner and is a coding/website newbie.
- Explain all technical steps in plain English. Never assume Trae knows terminal or code syntax.
- For anything done outside code (Supabase, Vercel, Google Cloud), give exact click-by-click steps.
- When Trae gives a correction, apply it and treat it as permanent.

---

## CURRENT STATUS — UPDATED (replaces the old "Ready to begin Step 1")

Phase 1 is essentially BUILT and partially LIVE. This is NOT a greenfield project.
Do not rebuild. The role now is to refine, debug, extend, and add the email-sync layer.

WHAT IS BUILT (verified in code):
- Auth: Google OAuth via Supabase; all routes protected by proxy.ts; auto profile creation on first login.
- Assets: list, add, edit, detail, delete, photos, status badges; per-asset mileage entry; oil/brake/tire service records.
- Maintenance: dashboard + oil-changes, brakes, tires, inspections, registrations pages.
  Due logic in lib/maintenance.ts (buckets: overdue, due_today, due_this_week, due_next_2_weeks, due_this_month).
- Repair tickets: list, create, detail, edit, status buttons, comments, photo upload, LIVE labor timer tied to ticket.
- Shop & time: clock in/out, status selector, my-tasks, general shop time, employee live status, time approvals.
- Payroll: report + CSV export (api/reports/payroll-csv). Expenses CSV export also built.
- Notifications: lib/notifications.ts rules — overdue maintenance, asset down/unsafe, forgot-to-clock-out (with dedup); bell + page.
- Auto-tickets: lib/auto-tickets.ts auto-opens tickets for overdue maintenance (skips if open ticket already exists).
- Mobile + PWA: /mobile screens (clock, mileage, report-issue, work-a-ticket), manifest.ts, sw.js, home-screen install.
- BEYOND original Phase 1 scope (already built): expenses module, fuel module, payment-methods, settings (company, users, roles, guide).

WHAT IS NOT BUILT:
- Email / Gmail sync. This is the ONLY unbuilt major feature. No Gmail code, no Gmail library installed yet.
- The database is ALREADY prepped for it (see EMAIL SYNC section).

---

## TECH STACK — ACTUAL (verified from package.json)

Frontend: Next.js 16.2.6 (App Router), React 19.2.4, TypeScript (required, never skip),
  Tailwind CSS 4, shadcn 4 + @base-ui/react, lucide-react.
Backend: Supabase (PostgreSQL + Auth + Storage + RLS). Google OAuth login.
Hosting: Vercel (deploys from GitHub).
Routing/auth note: Next 16 renamed middleware → proxy. Route protection lives in proxy.ts at repo root.

Project folder (Trae's Mac): ~/Documents/RPS Maintenance & Asset Project/rps-maintenance

---

## CONFIRMED FACTS — DO NOT ASK AGAIN

- Fleet size: 50–75 assets (trucks, trailers, equipment).
- Shop employees who clock in/out: 5. Total company employees: 50+.
- Login: company Gmail addresses via Google OAuth.
- Hosting region: US East (Virginia). Timezone: America/New_York.
- Private internal tool only — NOT a public SaaS.

---

## INSPECTION MODEL — IMPORTANT (corrected)

RPS does NOT do DOT inspections. Remove all DOT references when cleanup is approved.

There are TWO separate inspections — they are different things:
1. STATE INSPECTION — the formal annual inspection required by the state, performed by an
   authorized repair shop. This is the existing assets.inspection_due_date field.
   Keep it. Label it "State Inspection".
2. SERVICE INSPECTION — RPS's INTERNAL inspection performed any time an asset comes into the
   shop for an Oil Change / Service (catches tires, brakes, etc.). This is NEW and must be ADDED
   (its own due date/last-done tracking). Not yet built.

DOT cleanup still pending in code (do NOT run until Trae approves — he wants to demo to his dad first):
- Remove assets.dot_inspection_due_date column + any UI references.
- Remove the 'DOT' row from the maintenance_types seed.
- lib/auto-tickets.ts and lib/notifications.ts already ignore DOT and use inspection_due_date — good.

---

## DATABASE — ACTUAL TABLES (in supabase/schema.sql, ~20 tables, RLS enabled)

companies, profiles, asset_types, assets, maintenance_types, repair_tickets, maintenance_events,
repair_ticket_assignments, repair_ticket_comments, repair_ticket_attachments,
time_clock_entries, labor_entries, employee_statuses,
oil_change_records, brake_service_records, tire_service_records,
mileage_entries, notifications, activity_log, gmail_imports.

Key logic already in DB:
- Auto profile creation on first auth (handle_new_user trigger, default role 'viewer').
- Auto ticket numbers via sequence: TKT-1000, TKT-1001, ...
- Payroll hours = SUM(time_clock_entries.total_minutes) per pay period.
- Labor hours = SUM(labor_entries.total_minutes WHERE entry_type='ticket') grouped by ticket.
- employee_statuses holds each employee's live clock_status, current_status, current_ticket/asset, active labor entry.

Seed data loaded: company "RPS"; asset types (Service Truck, Construction Truck, Pickup Truck, Trailer,
Equipment, Machine, Other); maintenance types (incl. a 'DOT' row pending removal).

---

## ROLES & PERMISSIONS (profiles.role)

owner: full access, manage users/settings, all reports, payroll, approve/edit time.
manager: dashboard, create/edit/assign tickets, reports, employee status/hours, approve time.
shop_manager: manage tickets, assign shop employees, complete maintenance, asset status, approve shop time.
shop_employee: clock in/out, set status, start/pause/stop ticket work, update own tickets, photos/notes,
  parts flags, mark complete, view own time logs.
viewer: read-only dashboard + reports.

---

## EMAIL SYNC — THE NEXT BIG FEATURE (NOT yet built; do not start until Trae approves)

Goal: the app READS the company's existing Gmail inboxes and auto-populates the dashboard, so
employees keep emailing exactly as they do today and nobody changes their habits. This is the
strategy for overcoming Trae's father's reluctance to change.

The database is already prepped:
- gmail_imports table (review queue: pending → reviewed → converted → rejected → duplicate;
  fields for detected_asset, detected_priority, raw_payload, converted_ticket_id).
- repair_tickets.gmail_message_id and .gmail_thread_id (link ticket back to source email).
- repair_tickets.source includes 'gmail'; mileage_entries.source includes 'fuel_receipt'.

Existing RPS email inboxes and formats (the parser targets these):
- eshoptasks@gmail.com — shop repair tickets. New thread = new ticket; replies = updates;
  thread not archived until complete. ** FIRST inbox to wire up. **
- rptrucklog@gmail.com — time/labor. Subject = date + initials; first reply sets start ("@ shop"
  or location); each new task = reply ("L shop to 32346", "start P185 Trailer Inspection");
  body "EOD 7:00 - 17:00 - 10"; Wednesday (pay-period end) "EOW 7:00-17:00-10 T=45" (T = week total).
- Fuel emails — truck/equipment number, mileage, total gallons, oil level 1-9 → feeds mileage + maintenance-due.
- maintenancereceipt@gmail.com / Constructionreceipts@gmail.com — receipts. Subject:
  total - payment type/acct - site or asset number - description (e.g. "3.37 TEC 32367 soap for line testing").
- rptrailerlog@gmail.com — trailer in/out. Subject: initials, pulling asset #, date out, trailer #; body "out"/"in".

Recommended approach (MVP): Vercel Cron → an API route that uses Gmail API (read-only scope) to fetch
new messages, parse the structured subject/body, and insert into gmail_imports + create
tickets/mileage/etc. Anything that doesn't parse cleanly goes to a "Needs Review" queue.
OAuth: authorize each inbox once; store refresh tokens securely (Supabase). Verify current Google
OAuth/verification requirements at build time (policy changes); a private internal app with a small
set of authorized inboxes can avoid the costly third-party security assessment.

---

## SESSION RULES

1. Trae is a coding newbie — explain commands and where to click; give copy-paste-ready blocks.
2. TypeScript is required. Never skip it.
3. This is Next.js 16 / React 19 — confirm current APIs from node_modules/next docs before coding.
4. Always confirm before any destructive database operation (dropping columns, deleting rows).
5. Build/change one piece at a time and keep the app deployable.
6. Right now (pre-dad-demo) Trae does NOT want app changes — hold edits until he approves.
