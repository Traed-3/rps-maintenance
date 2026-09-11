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
 * Nothing here archives or modifies the source mailboxes yet — read-only
 * against Gmail, writes only land in Supabase. Archiving completed dispatches
 * is a deliberate follow-up step once this sync is verified against real data.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { listMessages, getMessage } from '@/lib/svc-gmail-client'
import {
  extractBody, getHeader, parseSender,
  parseDispatchEmail, parseCompletionEmail,
} from '@/lib/svc-work-order-parser'

export interface SvcSyncResult {
  dispatcher: { processed: number; created: number; updated: number; skipped: number; errors: string[] }
  invoicing:  { processed: number; matched: number; noMatch: number; skipped: number; errors: string[] }
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
        const { data: wo } = await admin
          .from('svc_work_orders')
          .select('id')
          .eq('portal_wo_number', parsed.woNumber)
          .maybeSingle()
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
        const { data: existing } = await admin
          .from('svc_work_orders')
          .select('id')
          .eq('source_portal', parsed.sourcePortal)
          .eq('portal_wo_number', parsed.woNumber)
          .maybeSingle()

        if (existing) {
          matchedWorkOrderId = existing.id
          importStatus = 'skipped'
          result.skipped++
        } else {
          const slaDueAt = parsed.priorityRank === 1
            ? new Date(receivedAt.getTime() + 4 * 60 * 60 * 1000).toISOString()
            : null

          const { data: inserted } = await admin.from('svc_work_orders').insert({
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
function recentWindowQuery(days: number): string {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const y = since.getFullYear()
  const m = String(since.getMonth() + 1).padStart(2, '0')
  const d = String(since.getDate()).padStart(2, '0')
  return `-in:spam -in:trash after:${y}/${m}/${d}`
}

export async function syncInvoicing(maxResults = 50): Promise<SvcSyncResult['invoicing']> {
  const admin = createAdminClient()
  const result = { processed: 0, matched: 0, noMatch: 0, skipped: 0, errors: [] as string[] }

  let msgIds: string[]
  try {
    msgIds = await listMessages('invoicing', recentWindowQuery(14), maxResults)
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
      const { email: techEmail } = parseSender(fromRaw)
      const body = extractBody(msg.payload)

      const parsed = parseCompletionEmail(subject, body)

      let matchedWorkOrderId: string | null = null
      let importStatus = 'no_match'

      if (parsed.woNumber) {
        const { data: candidates } = await admin
          .from('svc_work_orders')
          .select('id, dispatched_at')
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

      await admin.from('svc_gmail_imports').insert({
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

