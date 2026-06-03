import { NextRequest, NextResponse } from 'next/server'
import { syncGmailToTickets } from '@/lib/gmail-sync'

/**
 * GET /api/gmail/sync
 *
 * Called every 3 minutes by Vercel Cron.
 * Also callable manually from the Settings page with ?secret=CRON_SECRET
 *
 * Query params:
 *  - historical=true  → import emails all the way back to 2024/01/01
 *  - max=N            → limit number of threads (default 200 for regular, 500 for historical)
 */
export async function GET(request: NextRequest) {
  // Auth check — Vercel passes the secret in the Authorization header for crons
  const authHeader  = request.headers.get('authorization')
  const querySecret = request.nextUrl.searchParams.get('secret')
  const cronSecret  = process.env.CRON_SECRET

  const isAuthed =
    authHeader === `Bearer ${cronSecret}` ||
    querySecret === cronSecret

  if (!isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const historical  = request.nextUrl.searchParams.get('historical') === 'true'
  const maxThreads  = parseInt(request.nextUrl.searchParams.get('max') ?? (historical ? '500' : '100'), 10)

  try {
    const result = await syncGmailToTickets({ historical, maxThreads })

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      historical,
      ...result,
    })
  } catch (e: any) {
    console.error('[Gmail Sync Error]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
