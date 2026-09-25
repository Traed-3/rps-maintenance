import { NextRequest, NextResponse } from 'next/server'
import { syncAllInboxes, syncInbox, extractPending } from '@/lib/billing-inbox-sync'
import { BILLING_INBOXES, inboxStatus, type BillingInbox } from '@/lib/billing-gmail-client'
import { backfillPermitEmails } from '@/lib/permit-email-backfill'
import { backfillFieldTicketsForJob } from '@/lib/field-ticket-gmail-match'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/billing/inbox-sync?secret=…&pass=sync|extract|both|backfill-permits[&inbox=econstruction][&max=30][&since=14][&limit=3]
 *
 * Cron hits `pass=sync` then `pass=extract` on separate ticks so each stays
 * under the 60 s budget. `pass=both` is for a manual "sync now".
 *
 * `pass=backfill-permits[&offset=0][&limit=5][&apply=1]` is the one-time
 * historical-permit-email backfill (see lib/permit-email-backfill.ts) — a
 * read-only preview without `apply=1`, batched by `offset`/`limit` since
 * Gmail's full-message fetches are slow enough to risk the 60s budget across
 * all sites in one call. Re-run with the `nextOffset` the response returns
 * until it comes back null.
 *
 * `pass=backfill-field-tickets&jobId=…[&apply=1]` matches one job's
 * const.inv.rp field tickets to their econstruction typed updates and files
 * each as a needs_review con_daily_updates draft (see
 * lib/field-ticket-gmail-match.ts) — a read-only preview without `apply=1`.
 * Requires GMAIL_TOKEN_CONSTINVRP to be connected.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const secret = request.nextUrl.searchParams.get('secret')
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && secret !== process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const q = request.nextUrl.searchParams
  const pass = q.get('pass') ?? 'both'
  const maxResults = Math.min(parseInt(q.get('max') ?? '30', 10) || 30, 100)
  const sinceDays = Math.min(parseInt(q.get('since') ?? '14', 10) || 14, 365)
  const limit = Math.min(parseInt(q.get('limit') ?? '3', 10) || 3, 10)
  const only = q.get('inbox') as BillingInbox | null

  try {
    const out: Record<string, unknown> = { ok: true, timestamp: new Date().toISOString(), inboxes: inboxStatus().map(i => ({ key: i.key, connected: i.connected })) }
    if (pass === 'sync' || pass === 'both') {
      if (only && BILLING_INBOXES.some(i => i.key === only)) out.sync = [await syncInbox(only, { maxResults, sinceDays })]
      else out.sync = await syncAllInboxes({ maxResults, sinceDays })
    }
    if (pass === 'extract' || pass === 'both') out.extract = await extractPending(limit)
    if (pass === 'backfill-permits') {
      const offset = Math.max(parseInt(q.get('offset') ?? '0', 10) || 0, 0)
      const permitLimit = Math.min(parseInt(q.get('limit') ?? '5', 10) || 5, 10)
      out.backfillPermits = await backfillPermitEmails({ offset, limit: permitLimit, apply: q.get('apply') === '1' })
    }
    if (pass === 'backfill-field-tickets') {
      const jobId = q.get('jobId')
      if (!jobId) return NextResponse.json({ ok: false, error: 'jobId is required' }, { status: 400 })
      out.backfillFieldTickets = await backfillFieldTicketsForJob(jobId, { apply: q.get('apply') === '1' })
    }
    return NextResponse.json(out)
  } catch (e) {
    console.error('[Billing Inbox Sync Error]', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
