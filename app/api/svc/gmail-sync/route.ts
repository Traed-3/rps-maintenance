import { NextRequest, NextResponse } from 'next/server'
import { syncServiceDispatch } from '@/lib/svc-gmail-sync'

// Allow enough time to walk both mailboxes.
export const maxDuration = 60

/**
 * GET /api/svc/gmail-sync
 *
 * Reads rpdispatcher@gmail.com (new/updated work orders) and
 * rpinvoicing@gmail.com (tech completion notes, incl. RTN) and syncs both
 * into svc_work_orders. Same auth pattern as /api/gmail/sync.
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

  try {
    const result = await syncServiceDispatch()
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), ...result })
  } catch (e: any) {
    console.error('[Service Dispatch Sync Error]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
