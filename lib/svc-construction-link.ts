/**
 * Service call ↔ construction job link.
 *
 * A service call that needs construction work (a quote, a repair project) is handed to
 * econstruction.rp, becomes a con_jobs row, and from then on construction — not the tech's
 * "COMPLETE" email — is the source of truth for whether the work is done. The link is the
 * WO# on the job (con_jobs.work_order_number, set by "Start construction job" on a call or
 * by the master-schedule import).
 *
 * Pure DB reads — no Gmail — so it is cheap enough to run on every sync tick.
 */
import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** Construction stages meaning the physical work is finished (close-out and invoicing are paperwork). */
export const CON_DONE_STAGES = ['close_out', 'invoicing', 'complete'] as const
/** Stages meaning crews are actively on it. */
export const CON_ACTIVE_STAGES = ['in_progress'] as const

export const CON_STAGE_LABEL: Record<string, string> = {
  survey: 'Survey', permitting: 'Permitting', quoting: 'Quoting', material_ordering: 'Ordering materials',
  needs_scheduled: 'Needs scheduled', scheduled: 'Scheduled', in_progress: 'In progress', on_hold: 'On hold',
  return_needed: 'Return needed', close_out: 'Close-out', invoicing: 'Invoicing', complete: 'Complete',
  overspill_program: 'Overspill program',
}

export type ConstructionLink = {
  jobId: string
  jobNumber: string | null
  siteNumber: string | null
  stage: string
  statusDetail: string | null
  /** When the job reached its current done stage (stage history), else its last update. Only meaningful for done stages. */
  doneAt: string | null
  updatedAt: string | null
}

const WO_TOKEN = /\b(?:WOT|FWKD)\d+\b/gi

/** Every WO# written in a free-text work-order field ("WOT0061857-WOT0059119", "WOT1407564 New"). */
export function woTokens(text: string | null | undefined): string[] {
  return Array.from(new Set((text ?? '').match(WO_TOKEN)?.map(t => t.toUpperCase()) ?? []))
}

/**
 * WO# → the construction job carrying it (most recently updated wins if two jobs share one).
 * Only jobs with a WO# in `work_order_number` can link; the rest of the 1,500 construction jobs
 * were never tied to a service call.
 */
export async function loadConstructionLinks(admin: Admin, companyId: string): Promise<Map<string, ConstructionLink>> {
  const { data: jobs } = await admin
    .from('con_jobs')
    .select('id, job_number, site_number, stage, status_detail, work_order_number, updated_at')
    .eq('company_id', companyId)
    .not('work_order_number', 'is', null)

  const out = new Map<string, ConstructionLink>()
  const rows = (jobs ?? []).filter(j => woTokens(j.work_order_number).length)
  if (!rows.length) return out

  const doneIds = rows.filter(j => (CON_DONE_STAGES as readonly string[]).includes(j.stage)).map(j => j.id)
  const doneAtByJob = new Map<string, string>()
  if (doneIds.length) {
    const { data: hist } = await admin
      .from('con_job_stage_history')
      .select('job_id, to_stage, changed_at')
      .in('job_id', doneIds)
      .in('to_stage', CON_DONE_STAGES as unknown as string[])
      .order('changed_at', { ascending: true })
    // earliest move into any done stage = when the work was finished
    for (const h of hist ?? []) if (!doneAtByJob.has(h.job_id)) doneAtByJob.set(h.job_id, h.changed_at)
  }

  for (const j of rows) {
    const link: ConstructionLink = {
      jobId: j.id,
      jobNumber: j.job_number,
      siteNumber: j.site_number,
      stage: j.stage,
      statusDetail: j.status_detail,
      doneAt: (CON_DONE_STAGES as readonly string[]).includes(j.stage) ? (doneAtByJob.get(j.id) ?? j.updated_at) : null,
      updatedAt: j.updated_at,
    }
    for (const wo of woTokens(j.work_order_number)) {
      const prev = out.get(wo)
      if (!prev || (link.updatedAt ?? '') > (prev.updatedAt ?? '')) out.set(wo, link)
    }
  }
  return out
}
