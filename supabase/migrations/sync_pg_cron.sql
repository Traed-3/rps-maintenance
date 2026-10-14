-- Every-15-minute Gmail sync schedule, run by Supabase pg_cron instead of GitHub Actions.
--
-- Why: GitHub's `*/15` schedule on gmail-sync.yml only actually fired about every 6 hours (4 runs on 2026-10-12/13),
-- and Vercel Cron on the Hobby plan is limited to once a day. pg_cron fires on time, and pg_net makes the HTTP call.
--
-- ONE-TIME SETUP (Supabase dashboard → SQL Editor), BEFORE running this file:
--   1. Database → Extensions: enable pg_cron and pg_net (or let the CREATE EXTENSION lines below do it).
--   2. Store the app's CRON_SECRET (same value as the Vercel env var / GitHub secret) in Vault — run this yourself,
--      never commit the value:
--        select vault.create_secret('<CRON_SECRET value>', 'rps_cron_secret');
--   3. Run this file.
--
-- The app URL is the first line of rps_cron.call(); after a domain rename (docs/rebrand) change it there and re-run.
-- Check it's working:   select * from cron.job_run_details order by start_time desc limit 20;
--                       select id, status_code, left(content, 300) from net._http_response order by created desc limit 20;
-- Pause everything:     update cron.job set active = false where jobname like 'rps-%';

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Not in an API-exposed schema, so nothing outside the database can call it.
create schema if not exists rps_cron;
revoke all on schema rps_cron from public, anon, authenticated;

create or replace function rps_cron.call(path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base   text := 'https://rps-maintenance.vercel.app';
  secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'rps_cron_secret';
  if secret is null then
    raise exception 'Vault secret rps_cron_secret is missing — see the setup notes in sync_pg_cron.sql';
  end if;
  -- Bearer header (all three sync routes accept it) keeps the secret out of URLs and request logs.
  -- 300 s timeout matches the routes' maxDuration.
  return net.http_get(
    url := base || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 300000
  );
end;
$$;
revoke all on function rps_cron.call(text) from public, anon, authenticated;

-- Same passes the GitHub workflow ran, each its own request, staggered through the quarter hour so the
-- Gmail per-minute quota (6,000 units per mailbox) refills between the heavy ones. Re-running this file
-- replaces the jobs (cron.schedule upserts by name).
select cron.schedule('rps-maintenance-sync',  '0,15,30,45 * * * *',  $$select rps_cron.call('/api/gmail/sync?max=30')$$);
select cron.schedule('rps-svc-dispatcher',    '1,16,31,46 * * * *',  $$select rps_cron.call('/api/svc/gmail-sync?pass=dispatcher')$$);
select cron.schedule('rps-svc-invoicing',     '2,17,32,47 * * * *',  $$select rps_cron.call('/api/svc/gmail-sync?pass=invoicing&sinceDays=14&max=50')$$);
select cron.schedule('rps-svc-reconcile',     '4,19,34,49 * * * *',  $$select rps_cron.call('/api/svc/gmail-sync?pass=reconcile&apply=1')$$);
select cron.schedule('rps-svc-extract-docs',  '5,20,35,50 * * * *',  $$select rps_cron.call('/api/svc/gmail-sync?pass=extract-docs&limit=5')$$);
select cron.schedule('rps-billing-sync',      '6,21,36,51 * * * *',  $$select rps_cron.call('/api/billing/inbox-sync?pass=sync&max=30')$$);
select cron.schedule('rps-billing-extract',   '8,23,38,53 * * * *',  $$select rps_cron.call('/api/billing/inbox-sync?pass=extract&limit=3')$$);
select cron.schedule('rps-billing-updates',   '10,25,40,55 * * * *', $$select rps_cron.call('/api/billing/inbox-sync?pass=updates&since=3')$$);
select cron.schedule('rps-billing-orders',    '12,27,42,57 * * * *', $$select rps_cron.call('/api/billing/inbox-sync?pass=orders&since=3')$$);

-- pg_net keeps every response; trim to a week once a day.
select cron.schedule('rps-net-response-trim', '17 7 * * *', $$delete from net._http_response where created < now() - interval '7 days'$$);
