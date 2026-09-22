/**
 * Service-dispatch Gmail → svc_work_orders sync engine.
 *
 * Two mailboxes, two passes:
 *  1. rpdispatcher@gmail.com — every "work order dispatched" notice from
 *     7HELP (7-Eleven), WTSC (Wawa), and IT Service Desk (Sunoco) creates or
 *     updates a row in svc_work_orders.
 *  2. rpinvoicing@gmail.com — field techs forward the dispatch email back
 *     here with a one-line COMPLETE / INCOMPLETE / RTN note. We match it to
 *     the work order by WO# and update status + return-trip flag from it.
 *     This is the ONLY source of real completion status — never trust the
 *     dispatch mailbox alone for "is this done."
 *
 * A completion email marked COMPLETE also archives the original dispatch
 * email out of rpdispatcher's inbox (best-effort — a Gmail-side failure
 * never blocks the status update itself). RTN/incomplete emails only update
 * status; nothing gets archived until the job is actually done.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { listMessages, getMessage, archiveThread, archiveMessage, listAttachments, getAttachment } from '@/lib/svc-gmail-client'
import {
  extractBody, getHeader, parseSender,
  parseDispatchEmail, parseCompletionEmail,
} from '@/lib/svc-work-order-parser'

export const WORK_ORDER_DOCS_BUCKET = 'svc-work-order-docs'
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024
const MAX_ATTACHMENTS = 6

function safeName(name: string) {
  return name.replace(/[^\w.\-() ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'attachment'
}

/**
 * A tech's completion forward often carries a photo of the paper ticket (or a
 * PDF scan) — download it and file it against the matched work order so it's
 * ready for the human review step (manager-signature check + transcription)
 * before it can become a service ticket. Best-effort: never let a Gmail or
 * storage hiccup block the completion-status update itself.
 */
async function captureWorkOrderDocument(
  admin: ReturnType<typeof createAdminClient>,
  msg: any,
  msgId: string,
  subject: string,
  from: { name: string; email: string },
  receivedAt: Date,
  workOrderId: string | null,
): Promise<void> {
  const atts = listAttachments(msg).filter(a => a.size <= MAX_ATTACHMENT_BYTES).slice(0, MAX_ATTACHMENTS)
  if (!atts.length) return

  const stored: { name: string; mime: string; path: string; size: number }[] = []
  for (const a of atts) {
    const bytes = await getAttachment('invoicing', msgId, a.attachmentId)
    const path = `rpinvoicing/${msgId}/${safeName(a.filename)}`
    const { error } = await admin.storage.from(WORK_ORDER_DOCS_BUCKET).upload(path, bytes, { contentType: a.mimeType, upsert: true })
    if (error) throw new Error(`upload ${a.filename}: ${error.message}`)
    stored.push({ name: a.filename, mime: a.mimeType, path, size: bytes.length })
  }
  const primary = stored.find(s => /pdf/i.test(s.mime)) ?? stored.find(s => /^image\//i.test(s.mime)) ?? stored[0]
  const extractable = stored.some(s => /pdf|^image\/(jpeg|jpg|png|gif|webp)$/i.test(s.mime) || /\.(pdf|jpe?g|png|gif|webp)$/i.test(s.name))

  await admin.from('svc_work_order_documents').insert({
    company_id: COMPANY_ID, work_order_id: workOrderId,
    gmail_message_id: msgId, gmail_thread_id: msg.threadId,
    sender: from.name || from.email, sender_email: from.email, subject, received_at: receivedAt.toISOString(),
    attachments: stored, primary_path: primary?.path ?? null,
    extract_status: extractable ? 'pending' : 'skipped',
    extract_error: extractable ? null : 'Attachment type not readable automatically — type up the ticket by hand.',
    status: 'new',
  })
}

// Single-company deployment today (same constant used by the fleet gmail-sync) —
// every write is scoped to it so app-level company_id filtering (see app/(app)/service/*)
// actually has something to match against instead of silently returning nothing.
const COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'

export interface SvcSyncResult {
  dispatcher: { processed: number; created: number; updated: number; skipped: number; errors: string[] }
  invoicing:  { processed: number; matched: number; noMatch: number; skipped: number; errors: string[] }
}

/** Short-lived link to a work order document's attachment in the private bucket. */
export async function signedWorkOrderDocUrl(path: string, seconds = 600): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.storage.from(WORK_ORDER_DOCS_BUCKET).createSignedUrl(path, seconds)
  return data?.signedUrl ?? null
}

async function alreadyLogged(admin: ReturnType<typeof createAdminClient>, mailbox: string, messageId: string): Promise<boolean> {
  const { data } = await admin
    .from('svc_gmail_imports')
    .select('id')
    .eq('mailbox', mailbox)
    .eq('gmail_message_id', messageId)
    .maybeSingle()
  return !!data
}

// ── Pass 1: rpdispatcher → create/update work orders ───────────────────────

export async function syncDispatcher(maxResults = 50): Promise<SvcSyncResult['dispatcher']> {
  const admin = createAdminClient()
  const result = { processed: 0, created: 0, updated: 0, skipped: 0, errors: [] as string[] }

  let msgIds: string[]
  try {
    msgIds = await listMessages('dispatcher', 'in:inbox', maxResults)
  } catch (e: any) {
    result.errors.push(`List failed: ${e.message}`)
    return result
  }

  for (const msgId of msgIds) {
    try {
      if (await alreadyLogged(admin, 'rpdispatcher', msgId)) continue
      result.processed++

      const msg = await getMessage('dispatcher', msgId)
      const headers = msg.payload?.headers ?? []
      const subject = getHeader(headers, 'Subject')
      const fromRaw = getHeader(headers, 'From')
      const dateStr = getHeader(headers, 'Date')
      const receivedAt = dateStr ? new Date(dateStr) : new Date()
      const { name: senderName, email: senderEmail } = parseSender(fromRaw)
      const body = extractBody(msg.payload)

      const parsed = parseDispatchEmail(subject, body, senderName)

      let matchedWorkOrderId: string | null = null
      let importStatus = 'ignored'

      if (!parsed.woNumber) {
        importStatus = 'no_match'
      } else if (parsed.isInvoiceRejection) {
        const { data: woRows } = await admin
          .from('svc_work_orders')
          .select('id')
          .eq('portal_wo_number', parsed.woNumber)
          .order('dispatched_at', { ascending: false })
        const wo = woRows?.[0] ?? null
        if (wo) {
          await admin.from('svc_work_orders').update({
            invoice_rejected: true,
            invoice_rejection_reason: parsed.invoiceRejectionReason,
            last_update_at: receivedAt.toISOString(),
          }).eq('id', wo.id)
          matchedWorkOrderId = wo.id
          importStatus = 'updated_wo'
          result.updated++
        } else {
          importStatus = 'no_match'
        }
      } else if (parsed.isAssignmentOnly) {
        importStatus = 'ignored'
      } else {
        // WO# alone is the identity of a call — NOT source_portal too. A later
        // message about the same job (a priority-change notice, a reply, a
        // forward with an unrecognized sender) can get detected as a different
        // source_portal than the original dispatch, and matching on both used
        // to silently spawn a second, detail-blank row for the same real job.
        // That's exactly how completion/RTN notes ended up "attached" to an
        // invisible duplicate instead of the call, ordered so the process below
        // safely tolerates leftover duplicates from before this fix.
        const { data: existingRows } = await admin
          .from('svc_work_orders')
          .select('id')
          .eq('portal_wo_number', parsed.woNumber)
          .order('dispatched_at', { ascending: false })
        const existing = existingRows?.[0] ?? null

        if (existing) {
          matchedWorkOrderId = existing.id
          importStatus = 'skipped'
          result.skipped++
        } else {
          const slaDueAt = parsed.priorityRank === 1
            ? new Date(receivedAt.getTime() + 4 * 60 * 60 * 1000).toISOString()
            : null

          const { data: inserted } = await admin.from('svc_work_orders').insert({
            company_id:         COMPANY_ID,
            source_portal:      parsed.sourcePortal,
            client_name:        parsed.clientName,
            portal_wo_number:   parsed.woNumber,
            incident_number:    parsed.incidentNumber,
            site_number:        parsed.siteNumber,
            site_name:          parsed.siteName,
            site_address:       parsed.siteAddress,
            site_city:          parsed.siteCity,
            site_state:         parsed.siteState,
            priority_raw:       parsed.priorityRaw,
            priority_rank:      parsed.priorityRank,
            subject_raw:        subject,
            status:             'new',
            dispatched_at:      receivedAt.toISOString(),
            last_update_at:     receivedAt.toISOString(),
            sla_due_at:         slaDueAt,
            dispatch_gmail_message_id: msgId,
            raw_dispatch_payload: parsed,
          }).select('id').single()

          matchedWorkOrderId = inserted?.id ?? null
          importStatus = inserted ? 'created_wo' : 'no_match'
          if (inserted) result.created++
        }
      }

      await admin.from('svc_gmail_imports').insert({
        company_id:         COMPANY_ID,
        mailbox:            'rpdispatcher',
        gmail_message_id:   msgId,
        sender:             senderEmail,
        subject,
        received_at:        receivedAt.toISOString(),
        parsed,
        status:             importStatus,
        matched_work_order_id: matchedWorkOrderId,
      })

    } catch (e: any) {
      result.errors.push(`Message ${msgId}: ${e.message}`)
    }
  }

  return result
}

// ── Pass 2: rpinvoicing → update completion status ──────────────────────────

// The office reviews and archives every rpinvoicing message almost immediately
// (the "reviewed" label), so its Inbox is essentially always empty — searching
// in:inbox here would silently process nothing. Search all mail instead.
// Scoped to a recent window for now (this mailbox has 120k+ messages of
// history); a wider one-time historical backfill is a separate, deliberate step.
function ymd(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** `untilDays` (also counted back from now) lets a manual catch-up run walk
 * a big historical range in dated slices instead of one huge query — the
 * whole point being to stay well inside the 60s function budget. */
function recentWindowQuery(sinceDays: number, untilDays?: number): string {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
  let q = `-in:spam -in:trash after:${ymd(since)}`
  if (untilDays != null) {
    const until = new Date(Date.now() - untilDays * 24 * 60 * 60 * 1000)
    q += ` before:${ymd(until)}`
  }
  return q
}

export async function syncInvoicing(maxResults = 50, sinceDays = 14, untilDays?: number): Promise<SvcSyncResult['invoicing']> {
  const admin = createAdminClient()
  const result = { processed: 0, matched: 0, noMatch: 0, skipped: 0, errors: [] as string[] }

  let msgIds: string[]
  try {
    msgIds = await listMessages('invoicing', recentWindowQuery(sinceDays, untilDays), maxResults)
  } catch (e: any) {
    result.errors.push(`List failed: ${e.message}`)
    return result
  }

  for (const msgId of msgIds) {
    try {
      if (await alreadyLogged(admin, 'rpinvoicing', msgId)) continue
      result.processed++

      const msg = await getMessage('invoicing', msgId)
      const headers = msg.payload?.headers ?? []
      const subject = getHeader(headers, 'Subject')
      const fromRaw = getHeader(headers, 'From')
      const dateStr = getHeader(headers, 'Date')
      const receivedAt = dateStr ? new Date(dateStr) : new Date()
      const { name: techName, email: techEmail } = parseSender(fromRaw)
      const body = extractBody(msg.payload)

      const parsed = parseCompletionEmail(subject, body)

      let matchedWorkOrderId: string | null = null
      let importStatus = 'no_match'

      if (parsed.woNumber) {
        const { data: candidates } = await admin
          .from('svc_work_orders')
          .select('id, dispatched_at, dispatch_gmail_message_id, dispatch_gmail_thread_id')
          .eq('portal_wo_number', parsed.woNumber)
          .order('dispatched_at', { ascending: false })

        const wo = candidates?.[0]
        if (wo) {
          const { data: tech } = await admin
            .from('svc_technicians')
            .select('id')
            .ilike('personal_email', techEmail)
            .maybeSingle()

          const updates: Record<string, unknown> = {
            last_update_at: receivedAt.toISOString(),
            completion_note_raw: parsed.note || null,
            completion_gmail_message_id: msgId,
          }
          if (tech) updates.assigned_technician_id = tech.id

          if (parsed.status === 'complete') {
            updates.status = 'completed'
            updates.completed_at = receivedAt.toISOString()
            updates.return_trip_needed = false

            // Clean up rpdispatcher now that the job is actually done — prefer
            // archiving the whole thread (a dispatch is often split across more
            // than one message, e.g. "assigned" + "dispatched"). Best-effort:
            // never let a Gmail hiccup (expired token, already gone) block the
            // completion status itself from being recorded.
            try {
              if (wo.dispatch_gmail_thread_id) {
                await archiveThread('dispatcher', wo.dispatch_gmail_thread_id)
              } else if (wo.dispatch_gmail_message_id) {
                await archiveMessage('dispatcher', wo.dispatch_gmail_message_id)
              }
            } catch (archiveErr: any) {
              result.errors.push(`Archive rpdispatcher for ${parsed.woNumber}: ${archiveErr.message}`)
            }
          } else if (parsed.status === 'rtn') {
            updates.status = 'rtn_needed'
            updates.return_trip_needed = true
            updates.return_trip_reason = parsed.note || null
          } else if (parsed.status === 'incomplete') {
            updates.status = 'in_progress'
          }
          // 'unknown' status: still log the note + touch last_update_at, leave status alone

          await admin.from('svc_work_orders').update(updates).eq('id', wo.id)
          matchedWorkOrderId = wo.id
          importStatus = 'matched'
          result.matched++
        } else {
          result.noMatch++
        }
      } else {
        result.noMatch++
      }

      try {
        await captureWorkOrderDocument(admin, msg, msgId, subject, { name: techName, email: techEmail }, receivedAt, matchedWorkOrderId)
      } catch (docErr: any) {
        result.errors.push(`Document capture for ${msgId}: ${docErr.message}`)
      }

      await admin.from('svc_gmail_imports').insert({
        company_id:         COMPANY_ID,
        mailbox:            'rpinvoicing',
        gmail_message_id:   msgId,
        sender:              techEmail,
        subject,
        received_at:        receivedAt.toISOString(),
        parsed,
        status:             importStatus,
        matched_work_order_id: matchedWorkOrderId,
      })

    } catch (e: any) {
      result.errors.push(`Message ${msgId}: ${e.message}`)
    }
  }

  return result
}

