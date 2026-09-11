import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { WorkOrderStatusBadge, PriorityBadge, StaleBadge, clientLabel } from '@/components/svc/work-order-badges'

const OPEN_STATUSES = ['new', 'dispatched', 'accepted', 'en_route', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']

const STATUS_FILTERS = [
  { value: '',           label: 'All Open' },
  { value: 'new',        label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'rtn_needed', label: 'Return Trip Needed' },
  { value: 'completed',  label: 'Completed' },
]

const CLIENT_FILTERS = [
  { value: '',                label: 'All Clients' },
  { value: '7help',           label: '7-Eleven' },
  { value: 'wtsc',            label: 'Wawa' },
  { value: 'it_service_desk', label: 'Sunoco' },
]

export default async function ServiceDispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; client?: string; view?: string }>
}) {
  const { status = '', client = '', view = '' } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  // Summary counts — the supervisor view: what's overdue, what needs a return trip,
  // what's unbilled. These drive the cards above the table.
  const [{ count: openCount }, { count: rtnCount }, { count: rejectedCount }, { data: staleCandidates }] = await Promise.all([
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).in('status', OPEN_STATUSES),
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).eq('return_trip_needed', true).not('status', 'in', '(completed,invoiced,paid)'),
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).eq('invoice_rejected', true),
    admin.from('svc_work_orders').select('id, last_update_at').in('status', OPEN_STATUSES).not('last_update_at', 'is', null),
  ])
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const staleCount = (staleCandidates ?? []).filter(w => new Date(w.last_update_at as string).getTime() < sevenDaysAgo).length

  let query = admin
    .from('svc_work_orders')
    .select(`
      id, source_portal, client_name, portal_wo_number, site_number, site_name,
      priority_raw, priority_rank, status, last_update_at, dispatched_at,
      return_trip_needed, invoice_rejected,
      svc_technicians(full_name)
    `)
    .order('last_update_at', { ascending: true })
    .limit(200)

  if (view === 'stale') {
    query = query.in('status', OPEN_STATUSES).lt('last_update_at', new Date(sevenDaysAgo).toISOString())
  } else if (status) {
    query = query.eq('status', status)
  } else {
    query = query.in('status', OPEN_STATUSES)
  }
  if (client) query = query.eq('source_portal', client)

  const { data: workOrders } = await query

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
          Service Dispatch
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          7-Eleven, Wawa & Sunoco work orders — synced automatically from rpdispatcher and rpinvoicing every 15 minutes
        </p>
      </div>

      {/* Supervisor summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Link href="/service" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 transition-colors">
          <p className="text-2xl font-bold text-gray-900">{openCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Open Work Orders</p>
        </Link>
        <Link href="/service?view=stale" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-red-300 transition-colors">
          <p className={`text-2xl font-bold ${staleCount ? 'text-red-600' : 'text-gray-900'}`}>{staleCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">No Update in 7+ Days</p>
        </Link>
        <Link href="/service?status=rtn_needed" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-red-300 transition-colors">
          <p className={`text-2xl font-bold ${rtnCount ? 'text-red-600' : 'text-gray-900'}`}>{rtnCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Return Trip Needed</p>
        </Link>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className={`text-2xl font-bold ${rejectedCount ? 'text-amber-600' : 'text-gray-900'}`}>{rejectedCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Invoice Rejected</p>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/service?status=${f.value}${client ? `&client=${client}` : ''}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              status === f.value && !view
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Client filter pills */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {CLIENT_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/service?client=${f.value}${status ? `&status=${status}` : ''}`}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              client === f.value
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Table */}
      {!workOrders?.length ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">No work orders match this view.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 w-28">WO #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Site</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Client</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Priority</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Tech</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Last Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {workOrders.map((w) => (
                  <ClickableRow key={w.id} href={`/service/${w.id}`}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{w.portal_wo_number}</td>
                    <td className="px-4 py-3">
                      <Link href={`/service/${w.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                        {w.site_number ?? '—'}
                      </Link>
                      {w.site_name && <div className="text-xs text-gray-400">{w.site_name}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                      {clientLabel(w.source_portal, w.client_name)}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <PriorityBadge priorityRaw={w.priority_raw} priorityRank={w.priority_rank} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <WorkOrderStatusBadge status={w.status} />
                        <StaleBadge lastUpdateAt={w.last_update_at} status={w.status} />
                        {w.invoice_rejected && (
                          <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Invoice Rejected</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell text-xs">
                      {(w as any).svc_technicians?.full_name ?? <span className="text-gray-400">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">
                      {w.last_update_at
                        ? new Date(w.last_update_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : '—'}
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
