import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { GeneralTimeForm } from './general-time-form'
import { logGeneralTime } from '../labor-actions'

export default async function GeneralTimePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id').eq('id', user!.id).single()

  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('clock_status')
    .eq('profile_id', profile!.id)
    .maybeSingle()

  const isClockedIn = empStatus?.clock_status === 'clocked_in'

  // Recent general entries
  const { data: recent } = await admin
    .from('labor_entries')
    .select('id, entry_type, description, total_minutes, started_at')
    .eq('profile_id', profile!.id)
    .neq('entry_type', 'ticket')
    .order('started_at', { ascending: false })
    .limit(10)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Log Shop Time</h1>
          <Link href="/shop" className="text-sm text-blue-600">← Shop</Link>
        </div>

        {!isClockedIn && (
          <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            ⚠️ You are not clocked in. Clock in first.
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <GeneralTimeForm action={logGeneralTime} disabled={!isClockedIn} />
        </div>

        {/* Recent entries */}
        {recent && recent.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Recent Entries</h2>
            <div className="space-y-2">
              {recent.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="font-medium text-gray-800 capitalize">
                      {e.entry_type.replace(/_/g, ' ')}
                    </p>
                    {e.description && <p className="text-xs text-gray-500">{e.description}</p>}
                  </div>
                  <span className="font-semibold text-gray-900 shrink-0 ml-2">
                    {e.total_minutes != null
                      ? e.total_minutes < 60
                        ? `${e.total_minutes}m`
                        : `${Math.floor(e.total_minutes / 60)}h ${e.total_minutes % 60}m`
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
