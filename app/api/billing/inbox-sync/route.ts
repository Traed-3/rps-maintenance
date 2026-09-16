import { NextRequest, NextResponse } from 'next/server'
import { syncAllInboxes, syncInbox, extractPending } from '@/lib/billing-inbox-sync'
import { BILLING_INBOXES, inboxStatus, type BillingInbox } from '@/lib/billing-gmail-client'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/billing/inbox-sync?secret=…&pass=sync|extract|both[&inbox=econstruction][&max=30][&since=14][&limit=3]
 *
 * Cron hits `pass=sync` then `pass=extract` on separate ticks so each stays
 * under the 60 s budget. `pass=both` is for a manual "sync now".
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
    return NextResponse.json(out)
  } catch (e) {
    console.error('[Billing Inbox Sync Error]', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
