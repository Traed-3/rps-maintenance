// ============================================================
// Construction module — shared types, constants, money math.
// PURE module: no server-only imports, so it is safe to import
// from both server pages AND client components. The server-side
// page guard lives in lib/construction-guard.ts.
// ============================================================

// ── Access control ──────────────────────────────────────────
// TEMPORARY LOCK: while the Construction module is still being refined it is
// restricted to specific user accounts only (Trae's two logins) so that NO
// other user — including the other family "owner" accounts — can see it yet.
// Gating is by user id (which every permission check already loads) rather
// than by role, so nothing can slip through.
//
// To roll the module out to the team later, replace the body of the two
// helpers below with a role check using these lists:
//   read roles:  ['owner', 'manager', 'construction_manager', 'estimator', 'viewer']
//   write roles: ['owner', 'manager', 'construction_manager', 'estimator']
export const CON_ALLOWED_USER_IDS: readonly string[] = [
  '09d76016-7ed8-427d-83c3-1f94c484c1ce', // finance.trae@proton.me  (Trae Dodson - Admin)
  '703891ec-8547-423c-bba3-baba65a950b2', // dodson3.trae@gmail.com  (Admin Acct)
]

// Pass the caller's profile object (must include `id`). Anyone not on the
// allowlist above gets false. During the temporary lock, read and write are
// the same gate (the allowed users can do everything).
type ConGateProfile = { id?: string | null } | null | undefined

export function canReadConstruction(profile?: ConGateProfile) {
  return !!profile?.id && CON_ALLOWED_USER_IDS.includes(profile.id)
}
export function canWriteConstruction(profile?: ConGateProfile) {
  return !!profile?.id && CON_ALLOWED_USER_IDS.includes(profile.id)
}

export type ConProfile = { id: string; company_id: string; role: string }

// ── Pipeline stages ─────────────────────────────────────────
// Ordered the way a job moves through the shop. `className` follows the
// existing Green/Yellow/Orange/Red/Gray badge bands used elsewhere in the app.
export const CON_STAGES = [
  { value: 'survey',            label: 'Survey',            className: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'quoting',           label: 'Quoting',           className: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'permitting',        label: 'Permitting',        className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  { value: 'material_ordering', label: 'Material Ordering', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  { value: 'needs_scheduled',   label: 'Needs Scheduled',   className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  { value: 'scheduled',         label: 'Scheduled',         className: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  { value: 'in_progress',       label: 'In Progress',       className: 'bg-green-100 text-green-800 border-green-200' },
  { value: 'on_hold',           label: 'On Hold',           className: 'bg-orange-100 text-orange-800 border-orange-200' },
  { value: 'return_needed',     label: 'Return Needed',     className: 'bg-red-100 text-red-800 border-red-200' },
  { value: 'close_out',         label: 'Close-Out',         className: 'bg-purple-100 text-purple-800 border-purple-200' },
  { value: 'invoicing',         label: 'Invoicing',         className: 'bg-teal-100 text-teal-800 border-teal-200' },
  { value: 'complete',          label: 'Complete',          className: 'bg-green-200 text-green-900 border-green-300' },
] as const

export const CON_STAGE_VALUES = CON_STAGES.map(s => s.value)
export const CON_OPEN_STAGES = CON_STAGE_VALUES.filter(s => s !== 'complete')

export function stageMeta(value: string) {
  return CON_STAGES.find(s => s.value === value) ?? CON_STAGES[0]
}

// ── Priorities ──────────────────────────────────────────────
export const CON_PRIORITIES = [
  { value: 'low',    label: 'Low',    className: 'bg-gray-100 text-gray-500 border-gray-200' },
  { value: 'normal', label: 'Normal', className: 'bg-slate-200 text-slate-700 border-slate-300' },
  { value: 'high',   label: 'High',   className: 'bg-orange-200 text-orange-900 border-orange-400' },
  { value: 'urgent', label: 'Urgent', className: 'bg-red-200 text-red-900 border-red-300' },
] as const

export function priorityMeta(value: string) {
  return CON_PRIORITIES.find(p => p.value === value) ?? CON_PRIORITIES[1]
}

// ── Quote / invoice / material statuses ─────────────────────
export const QUOTE_STATUSES = [
  { value: 'draft',    label: 'Draft',    className: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'sent',     label: 'Sent',     className: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'approved', label: 'Approved', className: 'bg-green-200 text-green-900 border-green-300' },
  { value: 'rejected', label: 'Rejected', className: 'bg-red-100 text-red-800 border-red-200' },
] as const

export const INVOICE_STATUSES = [
  { value: 'draft',   label: 'Draft',   className: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'sent',    label: 'Sent',    className: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'paid',    label: 'Paid',    className: 'bg-green-200 text-green-900 border-green-300' },
  { value: 'overdue', label: 'Overdue', className: 'bg-red-200 text-red-900 border-red-300' },
  { value: 'void',    label: 'Void',    className: 'bg-gray-100 text-gray-400 border-gray-200' },
] as const

export const MATERIAL_STATUSES = [
  { value: 'needed',   label: 'Needed',   className: 'bg-red-100 text-red-800 border-red-200' },
  { value: 'ordered',  label: 'Ordered',  className: 'bg-amber-100 text-amber-800 border-amber-200' },
  { value: 'received', label: 'Received', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'in_stock', label: 'In Stock', className: 'bg-green-100 text-green-800 border-green-200' },
] as const

export function statusMeta(
  list: ReadonlyArray<{ value: string; label: string; className: string }>,
  value: string,
) {
  return list.find(s => s.value === value) ?? list[0]
}

// ── Money math (recomputed server-side; never trust the client) ──
export type LineItemInput = {
  section: 'basic' | 'additional'
  line_no?: number | null
  description?: string | null
  quantity?: number | null
  unit_cost?: number | null
  labor_hours?: number | null
  labor_rate?: number | null
  item_type?: string | null
  is_stock?: boolean
}

export type ComputedLineItem = LineItemInput & {
  material_total: number
  total_labor: number
  total_material_labor: number
}

export type DocumentTotals = {
  basic_subtotal_material: number
  basic_subtotal_labor: number
  basic_total: number
  additional_subtotal_material: number
  additional_subtotal_labor: number
  additional_total: number
  grand_total: number
  profit_overhead_amount: number
  tax_amount: number
  final_total: number
}

const n = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0)
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Compute the per-line material/labor totals for one line item. */
export function computeLineItem(item: LineItemInput): ComputedLineItem {
  const material_total = round2(n(item.quantity) * n(item.unit_cost))
  const total_labor = round2(n(item.labor_hours) * n(item.labor_rate))
  return {
    ...item,
    material_total,
    total_labor,
    total_material_labor: round2(material_total + total_labor),
  }
}

/**
 * Compute every subtotal + total for a quote/invoice from its line items.
 * `profitOverheadPercent` and `salesTaxPercent` are decimals (0.06 = 6%).
 * Sales tax applies to MATERIAL subtotals only.
 */
export function computeDocumentTotals(
  items: LineItemInput[],
  profitOverheadPercent: number,
  salesTaxPercent: number,
): { totals: DocumentTotals; lines: ComputedLineItem[] } {
  const lines = items.map(computeLineItem)

  const sum = (section: 'basic' | 'additional', key: 'material_total' | 'total_labor') =>
    round2(lines.filter(l => l.section === section).reduce((acc, l) => acc + l[key], 0))

  const basic_subtotal_material = sum('basic', 'material_total')
  const basic_subtotal_labor = sum('basic', 'total_labor')
  const basic_total = round2(basic_subtotal_material + basic_subtotal_labor)

  const additional_subtotal_material = sum('additional', 'material_total')
  const additional_subtotal_labor = sum('additional', 'total_labor')
  const additional_total = round2(additional_subtotal_material + additional_subtotal_labor)

  const grand_total = round2(basic_total + additional_total)
  const profit_overhead_amount = round2(grand_total * n(profitOverheadPercent))
  const tax_amount = round2((basic_subtotal_material + additional_subtotal_material) * n(salesTaxPercent))
  const final_total = round2(grand_total + profit_overhead_amount + tax_amount)

  return {
    lines,
    totals: {
      basic_subtotal_material,
      basic_subtotal_labor,
      basic_total,
      additional_subtotal_material,
      additional_subtotal_labor,
      additional_total,
      grand_total,
      profit_overhead_amount,
      tax_amount,
      final_total,
    },
  }
}

// ── Formatting ──────────────────────────────────────────────
export function money(v: number | null | undefined) {
  return (n(v)).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function pctFromDecimal(v: number | null | undefined) {
  return round2(n(v) * 100)
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  // date-only strings: render without TZ shifting
  const parts = d.slice(0, 10).split('-')
  if (parts.length === 3) {
    const [y, m, day] = parts.map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Project Notification (brand pre-start notice) ───────────────
// Must go out starting 1 week before the project start date, and no later
// than 3 days before. So the send window is [start − 7, start − 3].
export const NOTIFY_WINDOW_OPEN_DAYS = 7
export const NOTIFY_DEADLINE_DAYS = 3

export type NotifyState = 'sent' | 'waived' | 'no_start' | 'scheduled' | 'send_now' | 'due_soon' | 'overdue'

type NotifyJob = {
  project_start_date: string | null
  notification_sent_at: string | null
  notification_waived: boolean | null
}

export type NotifyStatus = {
  state: NotifyState
  label: string
  className: string
  isDue: boolean            // in window (or past) and still needs sending
  startDate: string | null
  windowOpen: string | null // YYYY-MM-DD the window opens
  deadline: string | null   // YYYY-MM-DD the notice must be sent by
  daysToDeadline: number | null
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseYmd(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function dayDiff(a: Date, b: Date) { return Math.round((a.getTime() - b.getTime()) / 86400000) }

export function projectNotificationStatus(job: NotifyJob, now = new Date()): NotifyStatus {
  const base = { startDate: job.project_start_date, windowOpen: null, deadline: null, daysToDeadline: null, isDue: false }
  if (job.notification_waived) return { ...base, state: 'waived', label: 'Not required', className: 'bg-gray-100 text-gray-500 border-gray-200' }
  if (job.notification_sent_at) return { ...base, state: 'sent', label: `Sent ${fmtDate(job.notification_sent_at)}`, className: 'bg-green-100 text-green-700 border-green-200' }
  if (!job.project_start_date) return { ...base, state: 'no_start', label: 'No start date', className: 'bg-gray-100 text-gray-400 border-gray-200' }

  const start = parseYmd(job.project_start_date)
  const windowOpen = addDays(start, -NOTIFY_WINDOW_OPEN_DAYS)
  const deadline = addDays(start, -NOTIFY_DEADLINE_DAYS)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysToDeadline = dayDiff(deadline, today)
  const out = { startDate: job.project_start_date, windowOpen: ymd(windowOpen), deadline: ymd(deadline), daysToDeadline }

  if (today < windowOpen) {
    const opensIn = dayDiff(windowOpen, today)
    return { ...out, state: 'scheduled', isDue: false, label: `Opens in ${opensIn}d`, className: 'bg-blue-50 text-blue-700 border-blue-200' }
  }
  if (daysToDeadline < 0) {
    return { ...out, state: 'overdue', isDue: true, label: `Overdue ${-daysToDeadline}d`, className: 'bg-red-100 text-red-700 border-red-300' }
  }
  if (daysToDeadline <= 1) {
    return { ...out, state: 'due_soon', isDue: true, label: daysToDeadline === 0 ? 'Due today' : 'Due tomorrow', className: 'bg-orange-100 text-orange-800 border-orange-300' }
  }
  return { ...out, state: 'send_now', isDue: true, label: `Send now · ${daysToDeadline}d left`, className: 'bg-amber-100 text-amber-800 border-amber-200' }
}
