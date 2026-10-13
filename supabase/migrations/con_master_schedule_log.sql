-- Running history of Starsky's Master Schedule job rows (Job List + Completed Jobs tabs).
--
-- The workbook is overwritten every day, so a row's W/O ("WOT0061857" or the name of whoever authorized the work)
-- is gone once the row is cleared. scripts/sync-master-schedule-log.py (7:05 / 12:05 / 17:05, on the office Mac) upserts every row
-- it sees — one row per tab + site + W/O + scope, with first/last seen — and never deletes, so the authorization
-- stays on record. The ticket sync (lib/job-email-feed.ts) reads it first when a job has no WO#.
--
-- Run once in the Supabase SQL Editor.

create table if not exists con_master_schedule_log (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies on delete cascade,
  fingerprint      text not null unique,             -- sha1(tab|site_key|wo|scope): the same job row across days
  tab              text not null,                    -- 'Job List' | 'Completed Jobs'
  site_raw         text not null,
  site_key         text not null,                    -- 'SU-7415', '45976', 'Wawa 662'
  site_tokens      text[] not null default '{}',     -- site_key plus bare site numbers, for matching email subjects
  wo               text,                             -- W/O column as written: WO#s or who authorized it
  stage            text,
  status           text,
  notes            text,
  scope            text,
  facility_address text,
  date_received    text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  on_sheet         boolean not null default true      -- false once the row has left the workbook
);
create index if not exists con_master_schedule_log_tokens_idx on con_master_schedule_log using gin (site_tokens);
create index if not exists con_master_schedule_log_seen_idx on con_master_schedule_log (last_seen_at desc);

-- Service role only (the sync script and the cloud sync); nothing for app users to read directly yet.
alter table con_master_schedule_log enable row level security;
