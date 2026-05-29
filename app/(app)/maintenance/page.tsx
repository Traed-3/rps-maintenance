import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { DueBadge } from '@/components/maintenance/due-badge'
import {
  calcDateDue,
  calcOilChangeDue,
  toBand,
  BAND_CONFIG,
  sortByUrgency,
  type DueStatus,
} from '@/lib/maintenance'
import { Droplets, Circle, CircleDot, CalendarClock, FileText } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

type AssetRow = {
  id: string
  unit_number: string
  name: string | null
  make: string | null
  model: string | null
  status: string
  current_mileage: number | null
  next_oil_change_mileage: number | null
  next_brake_inspection_date: string | null
  next_tire_inspection_date: string | null
  inspection_due_date: string | null
  registration_due_date: string | null
  insurance_due_date: string | null
}

type AlertItem = {
  assetId: string
  unitNumber: string
  vehicleLabel: string
  category: string
  status: DueStatus
  daysUntil: number | null
  detail: string
  href: string
}

const BAND_ORDER: Array<keyof typeof BAND_CONFIG> = [
  'overdue',
  'due_this_week',
  'due_next_2_weeks',
  'due_this_month',
]

const BAND_STYLES = {
  overdue:          'border-red-200 bg-red-50',
  due_this_week:    'border-orange-200 bg-orange-50',
  due_next_2_weeks: 'border-yellow-200 bg-yellow-50',
  due_this_month:   'border-blue-100 bg-blue-50',
}

const BAND_HEADER = {
  overdue:          'text-red-700 bg-red-100',
  due_this_week:    'text-orange-700 bg-orange-100',
  due_next_2_weeks: 'text-yellow-700 bg-yellow-100',
  due_this_month:   'text-blue-700 bg-blue-100',
}

// ── Build all alert items from assets ─────────────────────────────────────────

function buildAlerts(assets: AssetRow[]): AlertItem[] {
  const items: AlertItem[] = []

  for (const a of assets) {
    if (a.status === 'retired') continue
    const label = [a.make, a.model].filter(Boolean).join(' ') || a.name || ''
    const base = { assetId: a.id, unitNumber: a.unit_number, vehicleLabel: label }

    // Oil change (mileage-based)
    const oil = calcOilChangeDue(a.current_mileage, a.next_oil_change_mileage)
    if (oil.status !== 'ok' && oil.status !== 'no_data') {
      items.push({ ...base, category: 'Oil Change', status: oil.status, daysUntil: oil.daysUntil, detail: oil.label, href: `/assets/${a.id}/maintenance/oil-change` })
    }

    // Brake inspection (date-based)
    const brake = calcDateDue(a.next_brake_inspection_date)
    if (brake.status !== 'ok' && brake.status !== 'no_data') {
      items.push({ ...base, category: 'Brake Inspection', status: brake.status, daysUntil: brake.daysUntil, detail: brake.label, href: `/assets/${a.id}/maintenance/brakes` })
    }

    // Tire inspection (date-based)
    const tire = calcDateDue(a.next_tire_inspection_date)
    if (tire.status !== 'ok' && tire.status !== 'no_data') {
      items.push({ ...base, category: 'Tire Inspection', status: tire.status, daysUntil: tire.daysUntil, detail: tire.label, href: `/assets/${a.id}/maintenance/tires` })
    }

    // State inspection
    const insp = calcDateDue(a.inspection_due_date)
    if (insp.status !== 'ok' && insp.status !== 'no_data') {
      items.push({ ...base, category: 'Inspection', status: insp.status, daysUntil: insp.daysUntil, detail: insp.label, href: `/assets/${a.id}/edit` })
    }

    // Registration / tag
    const reg = calcDateDue(a.registration_due_date)
    if (reg.status !== 'ok' && reg.status !== 'no_data') {
      items.push({ ...base, category: 'Registration', status: reg.status, daysUntil: reg.daysUntil, detail: reg.label, href: `/assets/${a.id}/edit` })
    }

    // Insurance
    const ins = calcDateDue(a.insurance_due_date)
    if (ins.status !== 'ok' && ins.status !== 'no_data') {
      items.push({ ...base, category: 'Insurance', status: ins.status, daysUntil: ins.daysUntil, detail: ins.label, href: `/assets/${a.id}/edit` })
    }
  }

  return sortByUrgency(items)
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function MaintenancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('company_id')
    .eq('id', user!.id)
    .single()

  const { data: assets } = await admin
    .from('assets')
    .select(`
      id, unit_number, name, make, model, status,
      current_mileage, next_oil_change_mileage,
      next_brake_inspection_date, next_tire_inspection_date,
      inspection_due_date,
      registration_due_date, insurance_due_date
    `)
    .eq('company_id', profile!.company_id)
    .neq('status', 'retired')
    .order('unit_number')

  const alerts = buildAlerts(assets ?? [])

  // Group by band
  const bands = {
    overdue:          alerts.filter(a => toBand(a.status) === 'overdue'),
    due_this_week:    alerts.filter(a => toBand(a.status) === 'due_this_week'),
    due_next_2_weeks: alerts.filter(a => toBand(a.status) === 'due_next_2_weeks'),
    due_this_month:   alerts.filter(a => toBand(a.status) === 'due_this_month'),
  }

  const totalAlerts = alerts.length

  const quickLinks = [
    { href: '/maintenance/oil-changes',   label: 'Oil Changes',   icon: Droplets },
    { href: '/maintenance/brakes',        label: 'Brakes',        icon: Circle },
    { href: '/maintenance/tires',         label: 'Tires',         icon: CircleDot },
    { href: '/maintenance/inspections',   label: 'Inspections',   icon: CalendarClock },
    { href: '/maintenance/registrations', label: 'Registrations', icon: FileText },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {totalAlerts === 0
            ? 'All assets are up to date.'
            : `${totalAlerts} item${totalAlerts !== 1 ? 's' : ''} need${totalAlerts === 1 ? 's' : ''} attention`}
        </p>
      </div>

      {/* Quick-nav pills */}
      <div className="flex flex-wrap gap-2 mb-8">
        {quickLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-colors"
          >
            <l.icon className="w-4 h-4" />
            {l.label}
          </Link>
        ))}
      </div>

      {totalAlerts === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="font-semibold text-gray-900">All clear!</p>
          <p className="text-sm text-gray-500 mt-1">
            No maintenance items are overdue or coming due soon.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {BAND_ORDER.map((band) => {
            const items = bands[band]
            if (items.length === 0) return null
            const cfg = BAND_CONFIG[band]
            return (
              <div key={band} className={`rounded-xl border overflow-hidden ${BAND_STYLES[band]}`}>
                {/* Band header */}
                <div className={`px-5 py-3 flex items-center justify-between ${BAND_HEADER[band]}`}>
                  <h2 className="font-bold text-sm uppercase tracking-wide">{cfg.label}</h2>
                  <span className="text-sm font-semibold">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Items */}
                <div className="divide-y divide-white/60">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-3 bg-white/60">
                      <div className="flex items-center gap-3 min-w-0">
                        <div>
                          <Link
                            href={`/assets/${item.assetId}`}
                            className="font-semibold text-gray-900 hover:text-blue-600 text-sm"
                          >
                            {item.unitNumber}
                          </Link>
                          {item.vehicleLabel && (
                            <span className="text-gray-500 text-sm ml-2">{item.vehicleLabel}</span>
                          )}
                          <p className="text-xs text-gray-500 mt-0.5">{item.category}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <span className="text-xs text-gray-600 hidden sm:block">{item.detail}</span>
                        <Link
                          href={item.href}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap"
                        >
                          Record →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
