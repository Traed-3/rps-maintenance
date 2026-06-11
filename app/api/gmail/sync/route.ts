import { NextRequest, NextResponse } from 'next/server'
import { syncGmailToTickets } from '@/lib/gmail-sync'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyGmailSyncError } from '@/lib/notifications'

const COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'

// Allow longer runs for historical backfills (chunked imports of older mail)
export const maxDuration = 60

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
  const after       = request.nextUrl.searchParams.get('after')  || undefined
  const before      = request.nextUrl.searchParams.get('before') || undefined
  const skipUnmatched = request.nextUrl.searchParams.get('matchedOnly') === 'true'
  const maxThreads  = parseInt(request.nextUrl.searchParams.get('max') ?? ((historical || after || before) ? '500' : '100'), 10)

  try {
    const result = await syncGmailToTickets({ historical, maxThreads, after, before, skipUnmatched })

    // If the refresh token died, the per-thread errors will say "Gmail token
    // error: invalid_grant ...". Surface that as an in-app + email notification
    // for managers so the next cron tick doesn't silently keep failing.
    const tokenError = result.errors.find(e =>
      /invalid_grant|expired or revoked|Gmail token error/i.test(e)
    )
    if (tokenError) {
      const admin = createAdminClient()
      await notifyGmailSyncError(admin, COMPANY_ID, tokenError).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      historical,
      ...result,
    })
  } catch (e: any) {
    console.error('[Gmail Sync Error]', e)
    if (/invalid_grant|expired or revoked|Gmail token error/i.test(e.message ?? '')) {
      const admin = createAdminClient()
      await notifyGmailSyncError(admin, COMPANY_ID, e.message).catch(() => {})
    }
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
