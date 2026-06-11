@AGENTS.md

# RPS Maintenance & Asset Tracker — Master Context (CLAUDE.md)

> Read this file at the start of EVERY session before doing anything.
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

## UI CONVENTIONS — STANDARD (follow for ALL new/edited tables)

**Clickable rows.** Any table whose rows represent a navigable record (an asset, ticket,
employee, expense, etc.) MUST make the WHOLE row clickable — not just a "View →" link.

- Use `<ClickableRow href="/path/{id}">…cells…</ClickableRow>` from
  `components/clickable-row.tsx` in place of the data `<tr>` (leave the header `<tr>` alone).
- `ClickableRow` already: navigates on click + Enter, shows a pointer cursor + hover/focus
  highlight, and **ignores clicks on nested `a` / `button` / `input` / `select` / `textarea` /
  `label` / `[role="button"]` / `[data-no-row-nav]`** and on text selection — so per-row
  action buttons/links (edit, delete, status, "Record →") keep working without extra code.
- Keep a small "View →" (or "Record →"/"Update →") cue in the last cell as an affordance; it
  can be a plain `<span>` since the whole row navigates.
- Applied across: assets, tickets, expenses, shop, shop/employees, dashboard (Open Tickets +
  Employee Status), and all maintenance lists (oil-changes, brakes, tires, inspections,
  registrations). New tables must match this.

---

## SESSION RULES

1. Trae is a coding newbie — explain commands and where to click; give copy-paste-ready blocks.
2. TypeScript is required. Never skip it.
3. This is Next.js 16 / React 19 — confirm current APIs from node_modules/next docs before coding.
4. Always confirm before any destructive database operation (dropping columns, deleting rows).
5. Build/change one piece at a time and keep the app deployable.
6. Trae actively requests and approves changes during sessions — implement them directly. (The old pre-dad-demo "hold all edits" freeze is lifted.) Still confirm before destructive DB operations per rule 4.
