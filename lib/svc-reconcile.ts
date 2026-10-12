/**
 * Service-call status reconciliation.
 *
 * Open calls pile up because the evidence that a call is finished lives in four places and
 * the sync only ever acted on one of them, one message at a time, in arrival order:
 *
 *   1. A tech's COMPLETE / RTN / INCOMPLETE note in rpinvoicing. If it landed before the
 *      call existed in the app it was logged `no_match` and never looked at again.
 *   2. 7-Eleven's "Invoice Approved" notice in rpdispatcher — the customer signed off on the
 *      invoice, so the job is done and billed. Used to be treated as a brand-new dispatch.
 *   3. "Redirected to another Service Provider" / Wawa "is Terminated" — the call left our hands.
 *   4. The construction job the call was handed to: once it is in close-out / invoicing /
 *      complete, the work is finished no matter what the service side still says.
 *
 * This replays all of it per open call in TIME order — the latest event decides — so a later
 * return trip still reopens a call and an old note never overrides a newer one. DB-only apart
 * from best-effort Gmail archiving of the dispatch email once a call is done (the standing
 * rule: completed ⇒ archive it out of rpdispatcher).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { archiveThread, archiveMessage } from '@/lib/svc-gmail-client'
import { isTrustedPortalNotice } from '@/lib/svc-work-order-parser'
import { loadConstructionLinks, CON_DONE_STAGES, CON_ACTIVE_STAGES, CON_STAGE_LABEL } from '@/lib/svc-construction-link'

type Admin = ReturnType<typeof createAdminClient>
const COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const BUDGET_MS = 40_000

type EventKind = 'complete' | 'approved' | 'rtn' | 'incomplete' | 'closed' | 'construction_done' | 'construction_active'
type Evidence = { at: string; kind: EventKind; source: string; note?: string | null; importId?: string; msgId?: string; invoiceNumber?: string | null; closedAs?: string }

export interface ReconcileChange { woNumber: string; from: string; to: string; source: string; at: string }
export interface ReconcileResult {
  dryRun: boolean
  openCalls: number
  changed: number
  toCompleted: number
  toRtn: number
  toInProgress: number
  archivedClosed: number
  importsAttached: number
  emailsArchived: number
  budgetHit: boolean
  errors: string[]
  changes: ReconcileChange[]
}

const INV_RE = /\bINV\d+\b/

function targetFor(kind: EventKind): 'completed' | 'rtn_needed' | 'in_progress' | 'closed' {
  switch (kind) {
    case 'complete': case 'approved': case 'construction_done': return 'completed'
    case 'rtn': return 'rtn_needed'
    case 'incomplete': case 'construction_active': return 'in_progress'
    case 'closed': return 'closed'
  }
}

export async function reconcileWorkOrders(opts: { dryRun?: boolean; archivedBy?: string | null } = {}): Promise<ReconcileResult> {
  const dryRun = opts.dryRun ?? true
  const admin: Admin = createAdminClient()
  const deadline = Date.now() + BUDGET_MS
  const result: ReconcileResult = {
    dryRun, openCalls: 0, changed: 0, toCompleted: 0, toRtn: 0, toInProgress: 0, archivedClosed: 0,
    importsAttached: 0, emailsArchived: 0, budgetHit: false, errors: [], changes: [],
  }

  const { data: open } = await admin
    .from('svc_work_orders')
    .select('id, portal_wo_number, status, notes, last_update_at, completed_at, dispatch_gmail_message_id, dispatch_gmail_thread_id, return_trip_needed')
    .eq('company_id', COMPANY_ID).eq('archived', false).neq('status', 'completed')
    .not('portal_wo_number', 'is', null)
  const calls = open ?? []
  result.openCalls = calls.length
  if (!calls.length) return result

  const byWo = new Map<string, typeof calls[number]>()
  for (const c of calls) byWo.set(c.portal_wo_number!, c)
  const woList = Array.from(byWo.keys())
  const events = new Map<string, Evidence[]>()
  const push = (wo: string, e: Evidence) => { const l = events.get(wo) ?? []; l.push(e); events.set(wo, l) }

  // 1. Tech notes in rpinvoicing (applied or not — the timeline decides).
  for (let i = 0; i < woList.length; i += 80) {
    const { data } = await admin
      .from('svc_gmail_imports')
      .select('id, gmail_message_id, received_at, status, parsed, subject')
      .eq('mailbox', 'rpinvoicing')
      .in('parsed->>woNumber', woList.slice(i, i + 80))
      .in('parsed->>status', ['complete', 'rtn', 'incomplete'])
    for (const r of data ?? []) {
      const wo = (r.parsed as any)?.woNumber as string
      push(wo, { at: r.received_at, kind: (r.parsed as any).status as EventKind, source: 'tech note in rpinvoicing', note: (r.parsed as any).note ?? null, importId: r.id, msgId: r.gmail_message_id })
    }
  }

  // 2 + 3. Closure notices in rpdispatcher (older imports carry no flag for these, so match on the subject).
  const { data: notices } = await admin
    .from('svc_gmail_imports')
    .select('id, gmail_message_id, received_at, subject, sender, parsed')
    .eq('mailbox', 'rpdispatcher')
    .or('subject.ilike.%invoice approved%,subject.ilike.%has been redirected%,subject.ilike.%is terminated%')
  for (const n of notices ?? []) {
    const wo = (n.parsed as any)?.woNumber as string | undefined
    if (!wo || !byWo.has(wo)) continue
    if (!isTrustedPortalNotice(n.sender ?? '')) continue   // only the customer's ticketing system can close a call
    const subj = n.subject ?? ''
    if (/invoice approved/i.test(subj)) push(wo, { at: n.received_at, kind: 'approved', source: 'invoice approved by customer', msgId: n.gmail_message_id, invoiceNumber: subj.match(INV_RE)?.[0] ?? null })
    else if (/has been redirected/i.test(subj)) push(wo, { at: n.received_at, kind: 'closed', source: 'redirected to another service provider', msgId: n.gmail_message_id, closedAs: `Redirected to another service provider — "${subj.trim().slice(0, 140)}"` })
    else if (/is terminated/i.test(subj)) push(wo, { at: n.received_at, kind: 'closed', source: 'terminated by the customer', msgId: n.gmail_message_id, closedAs: `Terminated by the customer — "${subj.trim().slice(0, 140)}"` })
  }

  // 4. Construction.
  const links = await loadConstructionLinks(admin, COMPANY_ID)
  for (const wo of woList) {
    const link = links.get(wo)
    if (!link) continue
    const label = `construction job ${link.jobNumber ?? link.siteNumber ?? ''} (${CON_STAGE_LABEL[link.stage] ?? link.stage})`.replace('  ', ' ')
    if ((CON_DONE_STAGES as readonly string[]).includes(link.stage) && link.doneAt) push(wo, { at: link.doneAt, kind: 'construction_done', source: label })
    else if ((CON_ACTIVE_STAGES as readonly string[]).includes(link.stage) && link.updatedAt) push(wo, { at: link.updatedAt, kind: 'construction_active', source: label })
  }

  // Replay per call.
  for (const [wo, evs] of events) {
    if (Date.now() > deadline) { result.budgetHit = true; break }
    const call = byWo.get(wo)!
    evs.sort((a, b) => a.at.localeCompare(b.at))
    const last = evs[evs.length - 1]
    const target = targetFor(last.kind)

    // 'construction_active' only ever promotes a call nobody has touched; it must not downgrade real progress.
    if (last.kind === 'construction_active' && call.status !== 'dispatched') continue
    const currentTarget = call.status
    if (target !== 'closed' && target === currentTarget) {
      // Status already right — but still attach any orphaned tech notes so they stop showing as "no match".
      if (!dryRun) await attachImports(admin, call.id, evs, result)
      continue
    }

    result.changes.push({ woNumber: wo, from: call.status, to: target === 'closed' ? 'archived' : target, source: last.source, at: last.at })
    if (dryRun) { tally(result, target); continue }

    try {
      const stamp = `[auto ${new Date().toISOString().slice(0, 10)}] ${target === 'closed' ? 'Closed' : 'Status → ' + target} — ${last.source}.`
      const notes = [call.notes, stamp].filter(Boolean).join('\n')
      const lastUpdate = [call.last_update_at, last.at].filter(Boolean).sort().pop()!

      if (target === 'closed') {
        await admin.from('svc_work_orders').update({
          archived: true, archived_at: new Date().toISOString(), archived_reason: `${last.closedAs} (${last.at.slice(0, 10)}).`,
          archived_by: opts.archivedBy ?? null, last_update_at: lastUpdate, notes,
        }).eq('id', call.id).eq('archived', false)
        result.archivedClosed++
        await archiveDispatchEmail(call, last.msgId, result)
      } else {
        const updates: Record<string, unknown> = { status: target, last_update_at: lastUpdate, notes }
        if (target === 'completed') {
          updates.completed_at = last.at
          updates.return_trip_needed = false
          if (last.kind === 'approved') { updates.invoiced = true; if (last.invoiceNumber) updates.invoice_number = last.invoiceNumber }
          if (last.kind === 'complete') { updates.completion_note_raw = last.note ?? null; updates.completion_gmail_message_id = last.msgId }
        } else if (target === 'rtn_needed') {
          updates.return_trip_needed = true
          updates.return_trip_reason = last.note ?? null
          updates.completion_note_raw = last.note ?? null
          updates.completion_gmail_message_id = last.msgId
        } else if (target === 'in_progress' && last.kind === 'incomplete') {
          updates.completion_note_raw = last.note ?? null
          updates.completion_gmail_message_id = last.msgId
        }
        await admin.from('svc_work_orders').update(updates).eq('id', call.id)
        if (target === 'completed') await archiveDispatchEmail(call, last.kind === 'approved' ? last.msgId : undefined, result)
      }
      await attachImports(admin, call.id, evs, result)
      tally(result, target)
    } catch (e: any) {
      result.errors.push(`${wo}: ${e.message}`)
    }
  }

  result.changed = result.toCompleted + result.toRtn + result.toInProgress + result.archivedClosed
  return result
}

function tally(r: ReconcileResult, target: string) {
  if (target === 'completed') r.toCompleted++
  else if (target === 'rtn_needed') r.toRtn++
  else if (target === 'in_progress') r.toInProgress++
  else if (target === 'closed') r.archivedClosed++
}

/** Point tech notes that were logged `no_match` at the call they belong to. */
async function attachImports(admin: Admin, workOrderId: string, evs: Evidence[], r: ReconcileResult) {
  const ids = evs.filter(e => e.importId).map(e => e.importId!)
  if (!ids.length) return
  const { data } = await admin.from('svc_gmail_imports').update({ status: 'matched', matched_work_order_id: workOrderId }).in('id', ids).eq('status', 'no_match').select('id')
  r.importsAttached += data?.length ?? 0
}

/**
 * Completed / closed ⇒ clear the dispatch email out of rpdispatcher (the standing rule), plus the
 * rpdispatcher notice that closed it, if it was one. Best-effort — a Gmail hiccup never blocks the status.
 */
async function archiveDispatchEmail(
  call: { dispatch_gmail_thread_id: string | null; dispatch_gmail_message_id: string | null },
  noticeMsgId: string | undefined,
  r: ReconcileResult,
) {
  try {
    if (call.dispatch_gmail_thread_id) await archiveThread('dispatcher', call.dispatch_gmail_thread_id)
    else if (call.dispatch_gmail_message_id) await archiveMessage('dispatcher', call.dispatch_gmail_message_id)
    if (noticeMsgId) await archiveMessage('dispatcher', noticeMsgId)
    r.emailsArchived++
  } catch (e: any) { r.errors.push(`archive dispatch email: ${e.message}`) }
}
