import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TicketStatusBadge, PriorityBadge } from '@/components/tickets/ticket-badges'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

const STATUS_FILTERS = [
  { value: '', label: 'All Open' },
  { value: 'new', label: 'New' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_parts', label: 'Waiting Parts' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
]

const CLOSED_STATUSES = ['completed', 'closed', 'deferred']

const DUE_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  week:    'Due This Week',
  month:   'Due This Month',
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; q?: string; due?: string }>
}) {
  const { status = '', priority = '', q = '', due = '' } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  let query = admin
    .from('repair_tickets')
    .select(`
      id, ticket_number, title, status, priority, parts_needed, waiting_on_parts,
      created_at, updated_at,
      assets(unit_number, make, model),
      profiles!repair_tickets_assigned_to_fkey(full_name)
    `)
    .eq('company_id', profile!.company_id)
    .order('updated_at', { ascending: false })

  // Status / due-date filtering
  if (due) {
    // Due-date views (match the dashboard maintenance-due cards) — open tickets only
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]
    query = query.not('status', 'in', `(${CLOSED_STATUSES.join(',')})`).not('due_date', 'is', null)
    if (due === 'overdue') {
      query = query.lt('due_date', todayStr)
    } else if (due === 'week') {
      const wk = new Date(today); wk.setDate(wk.getDate() + 7)
      query = query.gte('due_date', todayStr).lte('due_date', wk.toISOString().split('T')[0])
    } else if (due === 'month') {
      const me = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      query = query.gte('due_date', todayStr).lte('due_date', me.toISOString().split('T')[0])
    }
  } else if (!status) {
    // Default open list — hide closed and the Registration / State-Inspection reminders
    query = query
      .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
      .not('title', 'ilike', 'Registration%')
      .not('title', 'ilike', 'State Inspection%')
  } else if (status === 'waiting_parts') {
    // Match the same logic as the dashboard count: waiting_on_parts flag OR status
    query = query
      .or('waiting_on_parts.eq.true,status.eq.waiting_parts')
      .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
  } else {
    query = query.eq('status', status)
  }

  // Critical/Safety card counts both priorities together
  if (priority === 'critical') query = query.in('priority', ['critical', 'safety'])
  else if (priority)           query = query.eq('priority', priority)

  if (q) query = query.or(`title.ilike.%${q}%,ticket_number.ilike.%${q}%`)

  const { data: tickets } = await query
  const canCreate = ['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {due ? DUE_LABELS[due] ?? 'Repair Tickets' : 'Repair Tickets'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {tickets?.length ?? 0} ticket{tickets?.length !== 1 ? 's' : ''}
            {due ? '' : (status || priority || q ? ' (filtered)' : ' open')}
          </p>
        </div>
        {canCreate && (
          <Link href="/tickets/new">
            <Button className="gap-2"><Plus className="w-4 h-4" />New Ticket</Button>
          </Link>
        )}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <form method="GET" className="flex gap-2 flex-1">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search ticket # or title…"
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {status   && <input type="hidden" name="status"   value={status} />}
          {priority && <input type="hidden" name="priority" value={priority} />}
          {due      && <input type="hidden" name="due"      value={due} />}
          <button type="submit" className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
            Search
          </button>
        </form>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/tickets?status=${f.value}${q ? `&q=${q}` : ''}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              status === f.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Tickets table */}
      {!tickets?.length ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">
            {q || status ? 'No tickets match your filters.' : 'No open tickets. Great work!'}
          </p>
          {canCreate && !q && !status && (
            <Link href="/tickets/new" className="mt-4 inline-block">
              <Button className="gap-2"><Plus className="w-4 h-4" />New Ticket</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 w-24">Ticket #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Title</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Asset</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Priority</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Assigned To</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.ticket_number}</td>
                    <td className="px-4 py-3">
                      <Link href={`/tickets/${t.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                        {t.title}
                      </Link>
                      {(t.parts_needed || t.waiting_on_parts) && (
                        <div className="flex gap-1 mt-0.5">
                          {t.parts_needed    && <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Parts Needed</span>}
                          {t.waiting_on_parts && <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">Waiting Parts</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                      {(t as any).assets?.unit_number ?? '—'}
                    </td>
                    <td className="px-4 py-3"><TicketStatusBadge status={t.status} /></td>
                    <td className="px-4 py-3 hidden sm:table-cell"><PriorityBadge priority={t.priority} /></td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                      {(t as any).profiles?.full_name ?? <span className="text-gray-400">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">
                      {new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/tickets/${t.id}`} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
