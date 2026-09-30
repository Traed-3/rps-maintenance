/**
 * Construction focus dashboard — the five tiles the department is run from.
 * They mirror the Job List legend in Trae's "1 - Master schedule.xlsm" (same
 * stage names and fill colors) and answer one question each:
 *
 *   needs_scheduled   open projects / heavy-maintenance calls that need to be scheduled and completed
 *   parts_in          material has arrived and the job is waiting for a slot on the schedule
 *   in_progress       crews are on it now
 *   started           work began but the job is parked (on hold, return trip needed, start date passed with no movement)
 *   needs_invoicing   field work complete, waiting on close-out / final invoice
 *
 * Everything here is pure: it takes the rows the page already loads and returns
 * the tile lists, so the rules are easy to read and easy to change.
 */

export type FocusJob = {
  id: string
  site_number: string | null
  job_number?: string | null
  work_order_number: string | null
  stage: string
  status_detail: string | null
  scope_of_work: string | null
  gas_brand: string | null
  priority: string | null
  date_received: string | null
  project_start_date: string | null
  updated_at: string | null
  customer_name?: string | null
}

export type MaterialTally = { total: number; needed: number; ordered: number; received: number; in_stock: number }

export type FocusTileKey = 'needs_scheduled' | 'parts_in' | 'in_progress' | 'started' | 'needs_invoicing'

export const FOCUS_TILES: {
  key: FocusTileKey
  title: string
  blurb: string
  /** stage the "view all" link filters on (the jobs table takes one stage) */
  linkStage: string
  /** exact fill + font color of the matching legend cell in 1 - Master schedule.xlsm (Job List, B1:D4) */
  band: string
}[] = [
  { key: 'needs_scheduled', title: 'Needs Scheduled',        blurb: 'Open projects and heavy-maintenance calls that need a date and a crew.', linkStage: 'needs_scheduled', band: 'bg-[#FFC000] text-black' },
  { key: 'parts_in',        title: 'Parts In, Waiting to Schedule', blurb: 'Material has been ordered and is here. Put it on the calendar.',   linkStage: 'material_ordering', band: 'bg-[#F8CBAD] text-black' },
  { key: 'in_progress',     title: 'In Progress',            blurb: 'Crews are on these now.',                                             linkStage: 'in_progress', band: 'bg-[#04FAE1] text-black' },
  { key: 'started',         title: 'Started, Not Complete',  blurb: 'Work began but the job is parked: on hold, return trip, or the start date passed.', linkStage: 'on_hold', band: 'bg-[#C00000] text-white' },
  { key: 'needs_invoicing', title: 'Complete, Needs Invoicing', blurb: 'Field work is done. Close out and send the final invoice.',      linkStage: 'invoicing', band: 'bg-[#FFFF00] text-black' },
]

export function emptyTally(): MaterialTally {
  return { total: 0, needed: 0, ordered: 0, received: 0, in_stock: 0 }
}

/** Fold con_job_materials rows into one tally per job. */
export function tallyMaterials(rows: { job_id: string; status: string | null }[]): Map<string, MaterialTally> {
  const map = new Map<string, MaterialTally>()
  for (const r of rows) {
    const t = map.get(r.job_id) ?? emptyTally()
    t.total += 1
    if (r.status === 'needed') t.needed += 1
    else if (r.status === 'ordered') t.ordered += 1
    else if (r.status === 'received') t.received += 1
    else if (r.status === 'in_stock') t.in_stock += 1
    map.set(r.job_id, t)
  }
  return map
}

/**
 * Is the material for this job on the shelf, so the only thing left is a schedule slot?
 *
 * Inputs available: the job (stage, status_detail free text such as
 * "Recieved - Ready to schedule" or "Pipe and couplings ordered", project_start_date)
 * and the tally of its Materials rows (needed / ordered / received / in_stock).
 * Most jobs have no Materials rows yet, so the free-text status matters as much as the tally.
 */
export function partsAreHere(job: FocusJob, tally: MaterialTally): boolean {
  // TODO(human): write the rule that says "parts are here". Return true when the
  // job should sit on the "Parts In, Waiting to Schedule" tile.
  void job; void tally
  return false
}

export function daysSince(iso: string | null | undefined, today: Date): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86_400_000))
}

const byOldestTouch = (a: FocusJob, b: FocusJob) => String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? ''))

/** Split open jobs into the five focus lists. A job appears on at most one tile. */
export function buildFocusTiles(jobs: FocusJob[], tallies: Map<string, MaterialTally>, todayIso: string): Record<FocusTileKey, FocusJob[]> {
  const out: Record<FocusTileKey, FocusJob[]> = { needs_scheduled: [], parts_in: [], in_progress: [], started: [], needs_invoicing: [] }
  for (const j of jobs) {
    const tally = tallies.get(j.id) ?? emptyTally()
    if (j.stage === 'close_out' || j.stage === 'invoicing') { out.needs_invoicing.push(j); continue }
    if (j.stage === 'in_progress') { out.in_progress.push(j); continue }
    if (j.stage === 'on_hold' || j.stage === 'return_needed') { out.started.push(j); continue }
    if (j.stage === 'scheduled' && j.project_start_date && j.project_start_date < todayIso) { out.started.push(j); continue }
    if ((j.stage === 'material_ordering' || j.stage === 'needs_scheduled') && partsAreHere(j, tally)) { out.parts_in.push(j); continue }
    if (j.stage === 'needs_scheduled' || j.stage === 'scheduled') { out.needs_scheduled.push(j); continue }
    // survey / quoting / permitting / material_ordering (parts not here) / overspill stay in the pipeline chips below the tiles
  }
  for (const k of Object.keys(out) as FocusTileKey[]) out[k].sort(byOldestTouch)
  return out
}
