import { NextRequest, NextResponse } from 'next/server'
import { syncDispatcher, syncInvoicing } from '@/lib/svc-gmail-sync'
import { extractPendingWorkOrderDocuments } from '@/lib/svc-work-order-docs-extract'

// Allow enough time for a full pass through one mailbox.
export const maxDuration = 60

/**
 * GET /api/svc/gmail-sync?pass=dispatcher|invoicing|extract-docs[&max=N|&limit=N|&sinceDays=N]
 *
 * `sinceDays` (invoicing only, default 14) — the rolling window is normally
 * fine since the 15-min cron never lets it lapse, but if the sync was ever
 * down for a stretch, or a completion note simply sat further back than 14
 * days before ever being fetched once, it falls outside the window forever.
 * Pass a much larger value for a one-time manual catch-up run.
 *
 * Each pass gets its own request (and its own 60s budget) — running both
 * mailboxes in one call proved too slow once invoicing had real volume
 * (first live run hit a 504 partway through). Omitting `pass` runs both
 * sequentially, which is fine for a manual/low-volume check but NOT what
 * the 15-min cron should do.
 *
 * `extract-docs` is a third, separate pass: Claude drafts a transcript for
 * completed-ticket attachments the invoicing pass captured (see
 * captureWorkOrderDocument in svc-gmail-sync.ts), bounded by `limit` so it
 * stays inside the same time budget.
 */
export async function GET(request: NextRequest) {
  const authHeader  = request.headers.get('authorization')
  const querySecret = request.nextUrl.searchParams.get('secret')
  const cronSecret  = process.env.CRON_SECRET

  const isAuthed =
    authHeader === `Bearer ${cronSecret}` ||
    querySecret === cronSecret

  if (!isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pass = request.nextUrl.searchParams.get('pass')
  const maxResults = parseInt(request.nextUrl.searchParams.get('max') ?? '50', 10)

  try {
    if (pass === 'dispatcher') {
      const dispatcher = await syncDispatcher(maxResults)
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), dispatcher })
    }
    if (pass === 'invoicing') {
      const sinceDays = parseInt(request.nextUrl.searchParams.get('sinceDays') ?? '14', 10)
      const untilParam = request.nextUrl.searchParams.get('untilDays')
      const untilDays = untilParam != null ? parseInt(untilParam, 10) : undefined
      const invoicing = await syncInvoicing(maxResults, sinceDays, untilDays)
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), invoicing })
    }
    if (pass === 'extract-docs') {
      const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '5', 10)
      const extracted = await extractPendingWorkOrderDocuments(limit)
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), extracted })
    }

    const dispatcher = await syncDispatcher(maxResults)
    const invoicing = await syncInvoicing(maxResults)
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), dispatcher, invoicing })
  } catch (e: any) {
    console.error('[Service Dispatch Sync Error]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
