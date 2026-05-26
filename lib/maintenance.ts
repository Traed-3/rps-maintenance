/**
 * Maintenance due calculation logic — single source of truth.
 * Matches the rules defined in CLAUDE.md exactly.
 */

export type DueStatus =
  | 'overdue'
  | 'due_today'
  | 'due_this_week'
  | 'due_next_2_weeks'
  | 'due_this_month'
  | 'ok'
  | 'no_data'

export interface DueResult {
  status: DueStatus
  daysUntil: number | null // negative = overdue by N days
  label: string
}

// ── Date-based due calculation ───────────────────────────────────────────────
// Used for: inspection, DOT, registration, insurance, brake next-inspection, tire next-inspection

export function calcDateDue(dueDateStr: string | null | undefined): DueResult {
  if (!dueDateStr) return { status: 'no_data', daysUntil: null, label: 'No date set' }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDateStr)
  due.setHours(0, 0, 0, 0)

  const diffMs = due.getTime() - today.getTime()
  const days = Math.ceil(diffMs / 86400000)

  if (days < 0)  return { status: 'overdue',          daysUntil: days, label: `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}` }
  if (days === 0) return { status: 'due_today',        daysUntil: 0,    label: 'Due today' }
  if (days <= 7)  return { status: 'due_this_week',    daysUntil: days, label: `Due in ${days} day${days !== 1 ? 's' : ''}` }
  if (days <= 14) return { status: 'due_next_2_weeks', daysUntil: days, label: `Due in ${days} days` }
  if (days <= 30) return { status: 'due_this_month',   daysUntil: days, label: `Due in ${days} days` }
  return { status: 'ok', daysUntil: days, label: `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` }
}

// ── Mileage-based oil change due calculation ─────────────────────────────────
// OVERDUE:  current_mileage >= next_oil_change_mileage
// DUE SOON: current_mileage >= next_oil_change_mileage - 500

export function calcOilChangeDue(
  currentMileage: number | null | undefined,
  nextOilChangeMileage: number | null | undefined
): DueResult {
  if (currentMileage == null || nextOilChangeMileage == null) {
    return { status: 'no_data', daysUntil: null, label: 'No mileage data' }
  }

  const milesLeft = nextOilChangeMileage - currentMileage

  if (milesLeft <= 0)   return { status: 'overdue',       daysUntil: null, label: `Overdue by ${Math.abs(milesLeft).toLocaleString()} mi` }
  if (milesLeft <= 500) return { status: 'due_this_week', daysUntil: null, label: `Due in ${milesLeft.toLocaleString()} mi` }
  return { status: 'ok', daysUntil: null, label: `${milesLeft.toLocaleString()} mi remaining` }
}

// ── Urgency sort order ────────────────────────────────────────────────────────

const STATUS_ORDER: Record<DueStatus, number> = {
  overdue:          0,
  due_today:        1,
  due_this_week:    2,
  due_next_2_weeks: 3,
  due_this_month:   4,
  ok:               5,
  no_data:          6,
}

export function sortByUrgency<T extends { status: DueStatus; daysUntil: number | null }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (orderDiff !== 0) return orderDiff
    // Within same bucket, sort by days ascending (most urgent first)
    if (a.daysUntil != null && b.daysUntil != null) return a.daysUntil - b.daysUntil
    return 0
  })
}

// ── Badge config ──────────────────────────────────────────────────────────────

export const DUE_BADGE: Record<DueStatus, { label: string; className: string }> = {
  overdue:          { label: 'Overdue',       className: 'bg-red-100 text-red-800 border-red-200' },
  due_today:        { label: 'Due Today',     className: 'bg-red-100 text-red-800 border-red-200' },
  due_this_week:    { label: 'Due This Week', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  due_next_2_weeks: { label: 'Due in 2 Wks',  className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  due_this_month:   { label: 'Due This Month',className: 'bg-blue-100 text-blue-800 border-blue-200' },
  ok:               { label: 'OK',            className: 'bg-green-100 text-green-800 border-green-200' },
  no_data:          { label: 'No Data',       className: 'bg-gray-100 text-gray-500 border-gray-200' },
}

// ── Band grouping ─────────────────────────────────────────────────────────────
// Groups a list of items into the four dashboard color bands

export type Band = 'overdue' | 'due_this_week' | 'due_next_2_weeks' | 'due_this_month'

export function toBand(status: DueStatus): Band | null {
  if (status === 'overdue' || status === 'due_today') return 'overdue'
  if (status === 'due_this_week')    return 'due_this_week'
  if (status === 'due_next_2_weeks') return 'due_next_2_weeks'
  if (status === 'due_this_month')   return 'due_this_month'
  return null
}

export const BAND_CONFIG = {
  overdue:          { label: 'Overdue',        color: 'red' as const },
  due_this_week:    { label: 'Due This Week',  color: 'orange' as const },
  due_next_2_weeks: { label: 'Due in 2 Weeks', color: 'yellow' as const },
  due_this_month:   { label: 'Due This Month', color: 'blue' as const },
}
