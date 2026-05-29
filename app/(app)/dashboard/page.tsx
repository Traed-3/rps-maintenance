import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/dashboard/stat-card'
import { TicketStatusBadge, PriorityBadge } from '@/components/tickets/ticket-badges'
import { StatusBadge } from '@/components/assets/status-badge'
import { calcDateDue, calcOilChangeDue, toBand, BAND_CONFIG, sortByUrgency, type DueStatus } from '@/lib/maintenance'
import { checkOverdueMaintenanceNotifications, checkForgotClockOut } from '@/lib/notifications'
import { createOverdueMaintenanceTickets } from '@/lib/auto-tickets'
import { ClipboardList, AlertTriangle, Truck, Package, Wrench, Calendar, Users, Clock, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_LABELS: Record<string, string> = {
  clocked_out: 'Clocked Out', at_shop: 'At Shop', working_on_ticket: 'Working on Ticket',
  waiting_parts: 'Waiting on Parts', parts_run: 'Parts Run', cleaning_shop: 'Cleaning Shop',
  helping_employee: 'Helping Employee', general_maintenance: 'General Maintenance',
  break: 'Break', lunch: 'Lunch', meeting: 'Meeting', off_site: 'Off Site', other: 'Other',
}

function minsAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  const h = Math.floor(diff / 60); const m = diff % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function fmtMins(mins: number) {
  const h = Math.floor(mins / 60); const m = mins % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

const BAND_STYLES = {
  overdue:          { header: 'bg-red-600 text-white' },
  due_this_week:    { header: 'bg-orange-500 text-white' },
  due_next_2_weeks: { header: 'bg-yellow-400 text-gray-900' },
  due_this_month:   { header: 'bg-blue-500 text-white' },
}

type AlertItem = {
  assetId: string; unitNumber: string; vehicleLabel: string
  category: string; status: DueStatus; daysUntil: number | null; detail: string; href: string
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, full_name, role').eq('id', user!.id).single()
  const companyId = profile!.company_id
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const weekStart  = new Date(todayStart); weekStart.setDate(todayStart.getDate() - todayStart.getDay())
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)

  const [
    { count: openCount },
    { count: criticalCount },
    { count: waitingCount },
    { data: downAssets },
    { data: allAssets },
    { data: employees },
    { data: todayClocks },
    { data: recentTickets },
    { count: completedToday },
    { count: completedWeek },
    { count: completedMonth },
  ] = await Promise.all([
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)'),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).in('priority', ['critical', 'safety']).not('status', 'in', '(completed,closed,deferred)'),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('waiting_on_parts', true).not('status', 'in', '(completed,closed,deferred)'),
    admin.from('assets').select('id, unit_number, name, make, model, year, status').eq('company_id', companyId).in('status', ['down', 'unsafe']),
    admin.from('assets').select('id, unit_number, name, make, model, status, current_mileage, next_oil_change_mileage, next_brake_inspection_date, next_tire_inspection_date, inspection_due_date, dot_inspection_due_date, registration_due_date, insurance_due_date').eq('company_id', companyId).neq('status', 'retired'),
    admin.from('profiles').select('id, full_name, role').eq('company_id', companyId).in('role', ['shop_employee', 'shop_manager']).eq('is_active', true).order('full_name'),
    admin.from('time_clock_entries').select('profile_id, clock_in, clock_out, total_minutes').eq('company_id', companyId).gte('clock_in', todayStart.toISOString()),
    admin.from('repair_tickets').select('id, ticket_number, title, status, priority, updated_at, assets(unit_number), profiles!repair_tickets_assigned_to_fkey(full_name)').eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').order('updated_at', { ascending: false }).limit(8),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['completed','closed']).gte('updated_at', todayStart.toISOString()),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['completed','closed']).gte('updated_at', weekStart.toISOString()),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['completed','closed']).gte('updated_at', monthStart.toISOString()),
  ])

  const empIds = (employees ?? []).map(e => e.id)
  const { data: empStatusData } = await admin
    .from('employee_statuses')
    .select('profile_id, clock_status, current_status, current_ticket_id, status_updated_at, repair_tickets(id, ticket_number, title)')
    .in('profile_id', empIds)

  const statusMap = Object.fromEntries((empStatusData ?? []).map(s => [s.profile_id, s]))
  const clockedInCount = (empStatusData ?? []).filter(s => s.clock_status === 'clocked_in').length
  const now = Date.now()

  const totalShopMins = (todayClocks ?? []).reduce((sum, e) => {
    return sum + (e.clock_out ? (e.total_minutes ?? 0) : Math.round((now - new Date(e.clock_in).getTime()) / 60000))
  }, 0)

  const hoursToday: Record<string, number> = {}
  for (const e of todayClocks ?? []) {
    const m = e.clock_out ? (e.total_minutes ?? 0) : Math.round((now - new Date(e.clock_in).getTime()) / 60000)
    hoursToday[e.profile_id] = (hoursToday[e.profile_id] ?? 0) + m
  }

  // Maintenance alerts
  const alerts: AlertItem[] = []
  for (const a of allAssets ?? []) {
    const label = [a.make, a.model].filter(Boolean).join(' ') || a.name || ''
    const checks = [
      { r: calcOilChangeDue(a.current_mileage, a.next_oil_change_mileage), category: 'Oil Change', href: `/assets/${a.id}/maintenance/oil-change` },
      { r: calcDateDue(a.next_brake_inspection_date), category: 'Brakes', href: `/assets/${a.id}/maintenance/brakes` },
      { r: calcDateDue(a.next_tire_inspection_date), category: 'Tires', href: `/assets/${a.id}/maintenance/tires` },
      { r: calcDateDue(a.inspection_due_date), category: 'Inspection', href: `/assets/${a.id}/edit` },
      { r: calcDateDue(a.dot_inspection_due_date), category: 'DOT Inspection', href: `/assets/${a.id}/edit` },
      { r: calcDateDue(a.registration_due_date), category: 'Registration', href: `/assets/${a.id}/edit` },
      { r: calcDateDue(a.insurance_due_date), category: 'Insurance', href: `/assets/${a.id}/edit` },
    ]
    for (const { r, category, href } of checks) {
      if (r.status !== 'ok' && r.status !== 'no_data') {
        alerts.push({ assetId: a.id, unitNumber: a.unit_number, vehicleLabel: label, category, status: r.status, daysUntil: r.daysUntil, detail: r.label, href })
      }
    }
  }
  const sortedAlerts = sortByUrgency(alerts)
  const overdueMaintCount = new Set(alerts.filter(a => toBand(a.status) === 'overdue').map(a => a.assetId)).size
  const dueThisWeekCount  = new Set(alerts.filter(a => toBand(a.status) === 'due_this_week').map(a => a.assetId)).size
  const totalAlerts = sortedAlerts.length

  const bands = {
    overdue:          sortedAlerts.filter(a => toBand(a.status) === 'overdue').slice(0, 6),
    due_this_week:    sortedAlerts.filter(a => toBand(a.status) === 'due_this_week').slice(0, 6),
    due_next_2_weeks: sortedAlerts.filter(a => toBand(a.status) === 'due_next_2_weeks').slice(0, 4),
    due_this_month:   sortedAlerts.filter(a => toBand(a.status) === 'due_this_month').slice(0, 4),
  }

  // Fire-and-forget background tasks
  checkOverdueMaintenanceNotifications(admin, companyId).catch(() => {})
  checkForgotClockOut(admin, companyId).catch(() => {})
  createOverdueMaintenanceTickets(admin, companyId).catch(() => {})

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Good {greeting}, {profile?.full_name?.split(' ')[0]}.{' '}
          {totalAlerts > 0 && (
            <span className="text-orange-600 font-medium">{totalAlerts} maintenance item{totalAlerts !== 1 ? 's' : ''} need attention.</span>
          )}
        </p>
      </div>

      {/* Row 1 — Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Open Tickets"      value={openCount ?? 0}           icon={ClipboardList} color="blue"   href="/tickets" />
        <StatCard label="Critical / Safety" value={criticalCount ?? 0}       icon={AlertTriangle} color="red"    href="/tickets?priority=critical" alert />
        <StatCard label="Vehicles Down"     value={downAssets?.length ?? 0}  icon={Truck}         color="red"    href="/assets?status=down" alert />
        <StatCard label="Waiting on Parts"  value={waitingCount ?? 0}        icon={Package}       color="orange" href="/tickets?status=waiting_parts" />
        <StatCard label="Overdue Maint."    value={overdueMaintCount}        icon={Wrench}        color="red"    href="/maintenance" alert />
        <StatCard label="Due This Week"     value={dueThisWeekCount}         icon={Calendar}      color="orange" href="/maintenance" />
        <StatCard label="Clocked In"        value={clockedInCount}           icon={Users}         color="green"  href="/shop" />
        <StatCard label="Shop Hrs Today"    value={(totalShopMins / 60).toFixed(1) + 'h'} icon={Clock} color="gray" href="/shop" />
      </div>

      {/* Tickets Completed Row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Completed Today"   value={completedToday ?? 0}  icon={CheckCircle} color="green" href="/tickets?status=completed" />
        <StatCard label="Completed This Week" value={completedWeek ?? 0} icon={CheckCircle} color="green" href="/tickets?status=completed" />
        <StatCard label="Completed This Month" value={completedMonth ?? 0} icon={CheckCircle} color="green" href="/tickets?status=completed" />
      </div>

      {/* Row 2 — Maintenance alert bands */}
      {totalAlerts > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">Maintenance Alerts</h2>
            <Link href="/maintenance" className="text-sm text-blue-600 hover:text-blue-800 font-medium">View all {totalAlerts} →</Link>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {(Object.entries(bands) as [keyof typeof bands, AlertItem[]][]).map(([band, items]) => {
              const allInBand = sortedAlerts.filter(a => toBand(a.status) === band)
              if (allInBand.length === 0) return null
              const cfg = BAND_CONFIG[band]
              const styles = BAND_STYLES[band]
              return (
                <div key={band} className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className={cn('px-3 py-2 text-xs font-bold uppercase tracking-wide', styles.header)}>
                    {cfg.label} · {allInBand.length}
                  </div>
                  <div className="divide-y divide-gray-50 bg-white">
                    {items.map((item, i) => (
                      <div key={i} className="px-3 py-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/assets/${item.assetId}`} className="text-xs font-semibold text-gray-900 hover:text-blue-600 truncate block">{item.unitNumber}</Link>
                          <p className="text-xs text-gray-500 truncate">{item.category}</p>
                        </div>
                        <Link href={item.href} className="text-xs text-blue-600 hover:text-blue-800 shrink-0 font-medium">Fix →</Link>
                      </div>
                    ))}
                    {allInBand.length > items.length && (
                      <div className="px-3 py-2">
                        <Link href="/maintenance" className="text-xs text-gray-400 hover:text-gray-600">+{allInBand.length - items.length} more →</Link>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Row 3 — Live employee status */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-900">Employee Status</h2>
          <Link href="/shop" className="text-sm text-blue-600 hover:text-blue-800 font-medium">Shop →</Link>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Employee</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Current Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden md:table-cell">Working On</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden lg:table-cell">Time on Status</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-500">Hours Today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(employees ?? []).map(emp => {
                  const s = statusMap[emp.id]
                  const mins = hoursToday[emp.id] ?? 0
                  return (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full shrink-0', s?.clock_status === 'clocked_in' ? 'bg-green-500' : 'bg-gray-300')} />
                          <Link href={`/shop/employees/${emp.id}`} className="font-medium text-gray-900 hover:text-blue-600">{emp.full_name}</Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-sm">{s ? STATUS_LABELS[s.current_status] ?? s.current_status : '—'}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {(s as any)?.repair_tickets ? (
                          <Link href={`/tickets/${(s as any).repair_tickets.id}`} className="text-xs text-blue-600 hover:underline">
                            {(s as any).repair_tickets.ticket_number}
                          </Link>
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">{s?.status_updated_at ? minsAgo(s.status_updated_at) : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{mins > 0 ? fmtMins(mins) : '—'}</td>
                    </tr>
                  )
                })}
                {!employees?.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No shop employees.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Row 4 — Open tickets */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-900">Open Tickets</h2>
          <Link href="/tickets" className="text-sm text-blue-600 hover:text-blue-800 font-medium">View all →</Link>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-24">Ticket #</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Title</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden md:table-cell">Asset</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden sm:table-cell">Priority</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden lg:table-cell">Assigned To</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden lg:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentTickets?.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{t.ticket_number}</td>
                    <td className="px-4 py-3"><Link href={`/tickets/${t.id}`} className="font-medium text-gray-900 hover:text-blue-600">{t.title}</Link></td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{(t as any).assets?.unit_number ?? '—'}</td>
                    <td className="px-4 py-3"><TicketStatusBadge status={t.status} /></td>
                    <td className="px-4 py-3 hidden sm:table-cell"><PriorityBadge priority={t.priority} /></td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{(t as any).profiles?.full_name ?? <span className="text-gray-400">Unassigned</span>}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">{new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  </tr>
                ))}
                {!recentTickets?.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">No open tickets. 🎉</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Row 5 — Due this month + Down assets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">Maintenance Due This Month</h2>
            <Link href="/maintenance" className="text-sm text-blue-600 hover:text-blue-800 font-medium">All →</Link>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {sortedAlerts.filter(a => toBand(a.status) === 'due_this_month').length === 0
              ? <p className="px-5 py-6 text-center text-sm text-gray-400">Nothing due this month.</p>
              : <div className="divide-y divide-gray-50">
                  {sortedAlerts.filter(a => toBand(a.status) === 'due_this_month').slice(0, 8).map((item, i) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <Link href={`/assets/${item.assetId}`} className="text-sm font-semibold text-gray-900 hover:text-blue-600">{item.unitNumber}</Link>
                        <p className="text-xs text-gray-500">{item.category} · {item.detail}</p>
                      </div>
                      <Link href={item.href} className="text-xs text-blue-600 hover:text-blue-800 font-medium shrink-0 ml-3">Record →</Link>
                    </div>
                  ))}
                </div>
            }
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">Assets Down / Unsafe</h2>
            <Link href="/assets?status=down" className="text-sm text-blue-600 hover:text-blue-800 font-medium">Assets →</Link>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {!downAssets?.length
              ? <p className="px-5 py-6 text-center text-sm text-gray-400">No assets currently down. ✅</p>
              : <div className="divide-y divide-gray-50">
                  {downAssets.map(a => (
                    <div key={a.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <Link href={`/assets/${a.id}`} className="text-sm font-semibold text-gray-900 hover:text-blue-600">{a.unit_number}</Link>
                        <p className="text-xs text-gray-500">{[a.year, a.make, a.model].filter(Boolean).join(' ') || a.name || '—'}</p>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                  ))}
                </div>
            }
          </div>
        </section>
      </div>

    </div>
  )
}
