import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TicketStatusBadge, PriorityBadge } from '@/components/tickets/ticket-badges'

export default async function MyTasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, full_name').eq('id', user!.id).single()

  const { data: tickets } = await admin
    .from('repair_tickets')
    .select('id, ticket_number, title, status, priority, parts_needed, waiting_on_parts, assets(unit_number, make, model)')
    .eq('assigned_to', profile!.id)
    .not('status', 'in', '(completed,closed,deferred)')
    .order('updated_at', { ascending: false })

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">My Tasks</h1>
          <a href="/shop/clock" className="text-sm text-blue-600">← Clock</a>
        </div>

        {!tickets?.length ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-gray-400 text-sm">No tickets assigned to you.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => (
              <Link
                key={t.id}
                href={`/tickets/${t.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-mono text-xs text-gray-400">{t.ticket_number}</span>
                  <div className="flex gap-1 shrink-0">
                    <PriorityBadge priority={t.priority} />
                  </div>
                </div>
                <p className="font-semibold text-gray-900 text-sm leading-snug mb-2">{t.title}</p>
                {(t as any).assets && (
                  <p className="text-xs text-gray-500 mb-2">
                    {(t as any).assets.unit_number}
                    {[(t as any).assets.make, (t as any).assets.model].filter(Boolean).length > 0 &&
                      ` — ${[(t as any).assets.make, (t as any).assets.model].filter(Boolean).join(' ')}`}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <TicketStatusBadge status={t.status} />
                  {t.waiting_on_parts && <span className="text-xs text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">⏳ Parts</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
