import { NextRequest, NextResponse } from 'next/server'
import { backfillAttachments } from '@/lib/gmail-sync'

export const maxDuration = 60

/**
 * GET /api/gmail/backfill-attachments?secret=CRON_SECRET&max=25&offset=0
 *
 * One-time backfill: walks existing Gmail-sourced tickets (newest first) and
 * attaches any photos/files from their email threads. Idempotent (dedupes by
 * filename), so it is safe to call repeatedly, advancing `offset` each time.
 */
export async function GET(request: NextRequest) {
  const querySecret = request.nextUrl.searchParams.get('secret')
  if (querySecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const max    = parseInt(request.nextUrl.searchParams.get('max') ?? '25', 10)
  const offset = parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10)

  try {
    const result = await backfillAttachments({ max, offset })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
