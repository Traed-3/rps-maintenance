/**
 * Gmail → Ticket sync engine.
 *
 * Flow:
 * 1. Fetch all threads matching query (inbox + historical from 2024)
 * 2. For each thread:
 *    a. First message → create ticket (if not already imported)
 *    b. Reply messages → update ticket status based on keywords
 * 3. Archived threads → mark ticket as completed/closed
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  listMessages,
  getThread,
  getAttachment,
  listThreadIds,
  markAsRead,
} from '@/lib/gmail-client'
import {
  parseSubject,
  extractUnitCandidates,
  titleWithoutUnit,
  extractBody,
  getHeader,
  parseSender,
  detectStatus,
  isPersonalVehicle,
  personalVehicleInitials,
  generateTicketNumber,
} from '@/lib/gmail-parser'

const COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
// Employee Vehicle asset type ID
const EMPLOYEE_VEHICLE_TYPE_ID = '289b1400-4a45-46f2-829b-9748b70c66b6'
const TERMINAL_STATUSES = ['closed', 'completed', 'deferred']

/** Automated Google emails (security alerts, etc.) are never tickets. */
function isGoogleSender(email: string): boolean {
  return /@(?:[a-z0-9.-]*\.)?google(?:mail)?\.com$/i.test(email)
}

// ── Asset helpers ─────────────────────────────────────────────────────────────

async function findOrCreateAsset(
  admin: ReturnType<typeof createAdminClient>,
  unitNumber: string
): Promise<string | null> {
  // Try exact match first
  const { data: asset } = await admin
    .from('assets')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .ilike('unit_number', unitNumber)
    .maybeSingle()

  if (asset) return asset.id

  // Auto-create personal vehicle assets (initials + PV, e.g. PWPV)
  if (isPersonalVehicle(unitNumber)) {
    const initials = personalVehicleInitials(unitNumber)
    const { data: newAsset } = await admin
      .from('assets')
      .insert({
        company_id:    COMPANY_ID,
        unit_number:   unitNumber.toUpperCase(),
        name:          `Personal Vehicle ${initials}`,
        status:        'active',
        asset_type_id: EMPLOYEE_VEHICLE_TYPE_ID,
      })
      .select('id')
      .single()
    return newAsset?.id ?? null
  }

  return null
}

/**
 * Fallback asset resolver. The shop usually puts the unit first, but some emails
 * bury it ("Breaks sound bad on t20"). When the first-word unit doesn't match a
 * real asset, scan the WHOLE subject for tokens that match existing assets'
 * unit numbers. Returns every distinct real asset found, in subject order.
 *
 * Only the caller decides whether to use it — a single confident match is
 * auto-linked; multiple matches (e.g. "Service due S19, J10, I9") stay in the
 * review queue rather than silently picking one and dropping the rest.
 */
async function findAssetsInSubject(
  admin: ReturnType<typeof createAdminClient>,
  subject: string,
  skipUnit: string,
): Promise<{ unitNumber: string; assetId: string; matchText: string; viaAlias: boolean }[]> {
  // Load the company's assets once (small table) so we can match both unit-number
  // tokens AND per-asset email aliases (e.g. "mini excavator" → E35).
  const { data: assets } = await admin
    .from('assets')
    .select('id, unit_number, email_aliases')
    .eq('company_id', COMPANY_ID)
  if (!assets?.length) return []

  const out: { unitNumber: string; assetId: string; matchText: string; viaAlias: boolean }[] = []
  const usedIds = new Set<string>()
  const add = (unitNumber: string, assetId: string, matchText: string, viaAlias: boolean) => {
    if (!usedIds.has(assetId)) { usedIds.add(assetId); out.push({ unitNumber, assetId, matchText, viaAlias }) }
  }

  // 1) Unit-number tokens anywhere in the subject (in subject order)
  const byUnit = new Map(assets.map(a => [a.unit_number.toUpperCase(), a]))
  const candidates = extractUnitCandidates(subject).filter(u => u !== skipUnit.toUpperCase())
  for (const cand of candidates) {
    const a = byUnit.get(cand)
    if (a) add(a.unit_number, a.id, cand, false)
  }

  // 2) Per-asset alias phrases ("mini excavator", "forklift", …)
  for (const a of assets) {
    for (const alias of ((a as any).email_aliases ?? []) as string[]) {
      if (!alias?.trim()) continue
      const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(subject)) { add(a.unit_number, a.id, alias.trim(), true); break }
    }
  }

  return out
}

// ── Attachment helpers ────────────────────────────────────────────────────────

type GmailAttachment = { attachmentId: string; filename: string; mimeType: string }

/** Walk a message payload and collect image/PDF attachments. */
function collectAttachments(payload: any): GmailAttachment[] {
  const out: GmailAttachment[] = []
  function walk(p: any) {
    if (!p) return
    const fn  = p.filename
    const aid = p.body?.attachmentId
    const mt  = p.mimeType ?? ''
    if (fn && aid && (/^image\//i.test(mt) || /application\/pdf/i.test(mt))) {
      out.push({ attachmentId: aid, filename: fn, mimeType: mt })
    }
    for (const part of p.parts ?? []) walk(part)
  }
  walk(payload)
  return out
}

/** Download a message's attachments and attach them to a ticket (idempotent by filename). */
async function syncMessageAttachments(
  admin: ReturnType<typeof createAdminClient>,
  messageId: string,
  payload: any,
  ticketId: string
): Promise<number> {
  let added = 0
  for (const att of collectAttachments(payload)) {
    try {
      const { data: exists } = await admin
        .from('repair_ticket_attachments')
        .select('id').eq('ticket_id', ticketId).eq('file_name', att.filename).maybeSingle()
      if (exists) continue

      const buf  = await getAttachment(messageId, att.attachmentId)
      const safe = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `gmail/${ticketId}/${Date.now()}-${safe}`

      const { error: upErr } = await admin.storage
        .from('ticket-attachments')
        .upload(path, buf, { contentType: att.mimeType || 'application/octet-stream', upsert: false })
      if (upErr) continue

      const { data: urlData } = admin.storage.from('ticket-attachments').getPublicUrl(path)
      await admin.from('repair_ticket_attachments').insert({
        ticket_id:   ticketId,
        uploaded_by: null,
        file_url:    urlData.publicUrl,
        file_name:   att.filename,
        file_type:   att.mimeType || null,
      })
      added++
    } catch { /* skip bad attachment, keep going */ }
  }
  return added
}

// ── Reporter helpers ──────────────────────────────────────────────────────────

async function findReporter(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .ilike('email', email)
    .maybeSingle()
  return data?.id ?? null
}

// ── Ticket number helpers ─────────────────────────────────────────────────────

async function buildTicketNumber(
  admin: ReturnType<typeof createAdminClient>,
  date: Date,
  unitNumber: string
): Promise<string> {
  const m    = date.getMonth() + 1
  const d    = date.getDate()
  const y    = date.getFullYear().toString().slice(-2)
  const base = `${m}${d}${y}${unitNumber}`

  const { data: existing } = await admin
    .from('repair_tickets')
    .select('ticket_number')
    .eq('company_id', COMPANY_ID)
    .or(`ticket_number.eq.${base},ticket_number.like.${base}[A-Z]`)

  const existingNums = (existing ?? []).map((t: any) => t.ticket_number)
  return generateTicketNumber(date, unitNumber, existingNums)
}

// ── Main sync function ────────────────────────────────────────────────────────

export interface SyncResult {
  processed:     number
  created:       number
  updated:       number
  skipped:       number
  review:        number   // unmatched assets parked in the review queue
  errors:        string[]
}

export async function syncGmailToTickets(options: {
  historical?: boolean   // true = include 2024+ emails, false = just recent
  maxThreads?: number
}): Promise<SyncResult> {
  const admin = createAdminClient()
  const result: SyncResult = { processed: 0, created: 0, updated: 0, skipped: 0, review: 0, errors: [] }

  // Query: inbox (open) + historical (archived/completed from 2024)
  const afterDate = options.historical ? '2024/01/01' : ''
  const inboxQuery  = afterDate ? `in:inbox after:${afterDate}` : 'in:inbox'
  const archiveQuery = afterDate ? `in:all -in:inbox -in:spam -in:trash after:${afterDate}` : ''

  const queries = archiveQuery
    ? [{ q: inboxQuery, isInbox: true }, { q: archiveQuery, isInbox: false }]
    : [{ q: inboxQuery, isInbox: true }]

  const seenThreadIds = new Set<string>()

  for (const { q, isInbox } of queries) {
    let msgIds: string[]
    try {
      msgIds = await listMessages(q, options.maxThreads ?? 500)
    } catch (e: any) {
      result.errors.push(`List failed (${q}): ${e.message}`)
      continue
    }

    for (const msgId of msgIds) {
      try {
        // Get the thread this message belongs to
        const msg = await admin
          .from('gmail_imports')
          .select('id, gmail_thread_id')
          .eq('gmail_message_id', msgId)
          .maybeSingle()

        // Get thread id from Gmail if we don't have it yet
        let threadId: string
        if (msg.data?.gmail_thread_id) {
          threadId = msg.data.gmail_thread_id
        } else {
          // Fetch message to get threadId
          const { getMessage } = await import('@/lib/gmail-client')
          const m = await getMessage(msgId)
          threadId = m.threadId
        }

        if (seenThreadIds.has(threadId)) continue
        seenThreadIds.add(threadId)

        result.processed++
        const r = await processThread(admin, threadId, isInbox)
        if (r === 'created') result.created++
        else if (r === 'updated') result.updated++
        else if (r === 'review') result.review++
        else result.skipped++

      } catch (e: any) {
        result.errors.push(`Thread for msg ${msgId}: ${e.message}`)
      }
    }
  }

  // Reconcile archived threads: close finished tickets + catch missed "complete" replies
  try {
    const inboxThreadIds = new Set(await listThreadIds('in:inbox'))
    await refreshArchivedOpenTickets(admin, inboxThreadIds, result)
  } catch (e: any) {
    result.errors.push(`Archived refresh failed: ${e.message}`)
  }

  return result
}

// ── Backfill: attach existing email tickets' photos/files ─────────────────────

export async function backfillAttachments(opts: { max?: number; offset?: number }): Promise<{ scanned: number; attached: number; nextOffset: number; done: boolean }> {
  const admin = createAdminClient()
  const max = opts.max ?? 25
  const offset = opts.offset ?? 0

  const { data: tickets } = await admin
    .from('repair_tickets')
    .select('id, gmail_thread_id')
    .eq('company_id', COMPANY_ID)
    .eq('source', 'gmail')
    .not('gmail_thread_id', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + max - 1)

  let attached = 0
  const scanned = (tickets ?? []).length
  for (const t of tickets ?? []) {
    try {
      const thread = await getThread(t.gmail_thread_id as string)
      for (const msg of thread.messages ?? []) {
        attached += await syncMessageAttachments(admin, msg.id, msg.payload, t.id)
      }
    } catch { /* skip unreadable thread */ }
  }

  return { scanned, attached, nextOffset: offset + scanned, done: scanned < max }
}

// ── Archived-thread reconciliation ────────────────────────────────────────────
//
// The regular sync only reads `in:inbox`, so if a "Complete" reply arrives and
// the thread is then archived, the inbox sync never sees it. This pass walks
// every open Gmail-sourced ticket whose thread is NOT in the inbox and:
//   1) processes any unseen replies (a "complete" reply → close + notes), then
//   2) if it's still open, treats "archived" as "done" and marks it completed.
// (We never archive anything ourselves — archiving is the owner's job.)

async function refreshArchivedOpenTickets(
  admin: ReturnType<typeof createAdminClient>,
  inboxThreadIds: Set<string>,
  result: SyncResult
) {
  const { data: openTickets } = await admin
    .from('repair_tickets')
    .select('id, gmail_thread_id, status')
    .eq('company_id', COMPANY_ID)
    .eq('source', 'gmail')
    .not('gmail_thread_id', 'is', null)
    .not('status', 'in', '(closed,completed,deferred)')

  for (const t of openTickets ?? []) {
    const threadId = t.gmail_thread_id as string
    if (inboxThreadIds.has(threadId)) continue   // inbox threads handled by the main loop

    try {
      // 1) Pick up any replies the inbox-only sync missed (e.g. a "complete" reply)
      await processThread(admin, threadId, false)

      // 2) Still open + archived ⇒ it's finished
      const { data: tk } = await admin.from('repair_tickets').select('status').eq('id', t.id).single()
      if (tk && !TERMINAL_STATUSES.includes(tk.status)) {
        const thread = await getThread(threadId)
        const msgs: any[] = thread.messages ?? []
        const last = msgs[msgs.length - 1]
        const note = last ? extractBody(last.payload).trim().slice(0, 1000) : ''
        const dateStr = last
          ? new Date(getHeader(last.payload?.headers ?? [], 'Date') || Date.now()).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0]
        await admin.from('repair_tickets').update({
          status:           'completed',
          date_completed:   dateStr,
          completion_notes: note || 'Email archived by staff — marked complete.',
        }).eq('id', t.id)
        result.updated++
      }
    } catch (e: any) {
      result.errors.push(`Refresh ${threadId}: ${e.message}`)
    }
  }
}

// ── Per-thread processing ─────────────────────────────────────────────────────

async function processThread(
  admin: ReturnType<typeof createAdminClient>,
  threadId: string,
  isInbox: boolean
): Promise<'created' | 'updated' | 'skipped' | 'review'> {

  // Check if thread already has a converted ticket
  const { data: existing } = await admin
    .from('gmail_imports')
    .select('id, converted_ticket_id, status')
    .eq('gmail_thread_id', threadId)
    .eq('company_id', COMPANY_ID)
    .order('created_at')
    .limit(1)
    .maybeSingle()

  // Fetch full thread from Gmail
  const thread = await getThread(threadId)
  const messages: any[] = thread.messages ?? []
  if (!messages.length) return 'skipped'

  const firstMsg  = messages[0]
  const headers   = firstMsg.payload?.headers ?? []
  const subject   = getHeader(headers, 'Subject')
  const fromRaw   = getHeader(headers, 'From')
  const dateStr   = getHeader(headers, 'Date')
  const msgDate   = dateStr ? new Date(dateStr) : new Date()

  let { unitNumber, title } = parseSubject(subject)
  const { email: senderEmail } = parseSender(fromRaw)

  let assetId = await findOrCreateAsset(admin, unitNumber)

  // If the first word wasn't a real asset, look for the unit elsewhere in the
  // subject ("Breaks sound bad on t20"). Auto-link only on a single confident
  // match; ambiguous multi-asset subjects fall through to the review queue.
  if (!assetId && !isPersonalVehicle(unitNumber)) {
    const found = await findAssetsInSubject(admin, subject, unitNumber)
    if (found.length === 1) {
      unitNumber = found[0].unitNumber
      assetId    = found[0].assetId
      // Unit-number tokens (e.g. "T20") are just IDs — strip them from the title.
      // Alias phrases (e.g. "fiberglass heat wrap") describe the actual problem,
      // so keep the full subject as the title.
      title      = found[0].viaAlias ? subject.trim() : titleWithoutUnit(subject, found[0].matchText)
    }
  }

  const reporterId = await findReporter(admin, senderEmail)
  const body       = extractBody(firstMsg.payload)

  // ── Thread already imported — process replies only ─────────────────────────
  if (existing?.converted_ticket_id) {
    const ticketId = existing.converted_ticket_id
    let updated = false

    // Track current status so a follow-up email can "start" the work
    const { data: curTicket } = await admin.from('repair_tickets').select('status').eq('id', ticketId).single()
    let curStatus: string = curTicket?.status ?? 'open'

    for (const reply of messages.slice(1)) {
      const replyHeaders = reply.payload?.headers ?? []
      const replyMsgId   = reply.id
      const replyBody    = extractBody(reply.payload)
      const replyFrom    = getHeader(replyHeaders, 'From')
      const { email: replyEmail } = parseSender(replyFrom)

      // Skip if already logged
      const { data: alreadyLogged } = await admin
        .from('gmail_imports')
        .select('id')
        .eq('gmail_message_id', replyMsgId)
        .maybeSingle()
      if (alreadyLogged) continue

      const status = detectStatus(replyBody)
      const updates: Record<string, unknown> = {}

      if (status.isComplete) {
        updates.status          = 'completed'
        updates.date_completed   = new Date(getHeader(replyHeaders, 'Date') || Date.now()).toISOString().split('T')[0]
        if (replyBody.trim()) updates.completion_notes = replyBody.trim().slice(0, 1000)
        const completedById = await findReporter(admin, replyEmail)
        if (completedById) updates.completed_by = completedById
      } else if (status.partsReceived) {
        updates.parts_needed      = false
        updates.parts_ordered     = true
        updates.waiting_on_parts  = false
      } else if (status.partsOrdered) {
        updates.parts_needed     = false
        updates.parts_ordered    = true
        updates.waiting_on_parts = true
        if (['new', 'open', 'assigned'].includes(curStatus)) updates.status = 'waiting_parts'
      } else if (status.partsNeeded) {
        // Parts mentioned but no explicit "ordered" — still belongs on the Waiting on
        // Parts list. Don't touch parts_ordered (we don't know if they've been ordered yet).
        updates.parts_needed     = true
        updates.waiting_on_parts = true
        if (['new', 'open', 'assigned'].includes(curStatus)) updates.status = 'waiting_parts'
      } else if (replyBody.trim() && ['new', 'open', 'assigned'].includes(curStatus)) {
        // A follow-up email / update / notes means work has started
        updates.status = 'in_progress'
      }

      if (Object.keys(updates).length) {
        await admin.from('repair_tickets').update(updates).eq('id', ticketId)
        if (typeof updates.status === 'string') curStatus = updates.status
        updated = true
      }

      // Add reply as comment
      const authorId = await findReporter(admin, replyEmail)
      if (replyBody.trim()) {
        await admin.from('repair_ticket_comments').insert({
          ticket_id:   ticketId,
          author_id:   authorId,
          comment:     `[Via Email] ${replyBody.trim().slice(0, 2000)}`,
          is_internal: false,
        })
      }

      // Log this reply message
      await admin.from('gmail_imports').insert({
        company_id:          COMPANY_ID,
        gmail_message_id:    replyMsgId,
        gmail_thread_id:     threadId,
        subject:             `RE: ${subject}`,
        sender:              replyEmail,
        received_at:         new Date(getHeader(replyHeaders, 'Date') || Date.now()).toISOString(),
        body_preview:        replyBody.slice(0, 500),
        status:              'converted',
        converted_ticket_id: ticketId,
        detected_asset:      unitNumber,
      })

      // Attach any photos / files from this reply to the ticket
      await syncMessageAttachments(admin, replyMsgId, reply.payload, ticketId)
    }

    return updated ? 'updated' : 'skipped'
  }

  // Thread already parked in the review queue (pending) or rejected — leave it alone
  if (existing) return 'skipped'

  // ── Ignore automated Google emails (security alerts, etc.) entirely ─────────
  if (isGoogleSender(senderEmail)) {
    await admin.from('gmail_imports').insert({
      company_id:       COMPANY_ID,
      gmail_message_id: firstMsg.id,
      gmail_thread_id:  threadId,
      subject,
      sender:           senderEmail,
      received_at:      msgDate.toISOString(),
      body_preview:     '',
      status:           'rejected',
      detected_asset:   unitNumber,
    })
    return 'skipped'
  }

  // ── Unmatched asset → park in review queue (do NOT create an orphan ticket) ─
  if (!assetId && !isPersonalVehicle(unitNumber)) {
    await admin.from('gmail_imports').insert({
      company_id:       COMPANY_ID,
      gmail_message_id: firstMsg.id,
      gmail_thread_id:  threadId,
      subject,
      sender:           senderEmail,
      received_at:      msgDate.toISOString(),
      body_preview:     body.slice(0, 500),
      status:           'pending',
      detected_asset:   unitNumber,
      raw_payload:      { title: title || subject, body: body.trim().slice(0, 3000) },
    })
    return 'review'
  }

  // ── New thread — create ticket ─────────────────────────────────────────────

  // Determine initial status from ALL messages
  let finalStatus: string = isInbox ? 'open' : 'closed'
  let partsNeeded   = false
  let partsOrdered  = false
  let partsReceived = false
  let dateCompleted: string | null = null
  let completedBy:   string | null = null

  for (const msg of messages) {
    const s = detectStatus(extractBody(msg.payload))
    if (s.isComplete) {
      finalStatus  = 'completed'
      dateCompleted = new Date(getHeader(msg.payload?.headers ?? [], 'Date') || Date.now())
        .toISOString().split('T')[0]
      // Resolve who sent the completion message → completed_by
      const fromHdr = getHeader(msg.payload?.headers ?? [], 'From')
      const { email: completerEmail } = parseSender(fromHdr)
      const completerId = await findReporter(admin, completerEmail)
      if (completerId) completedBy = completerId
    }
    if (s.partsNeeded)   partsNeeded   = true
    if (s.partsOrdered)  partsOrdered  = true
    if (s.partsReceived) partsReceived = true
  }

  // Anything parts-related that hasn't been received yet = pending → Waiting on Parts list
  const partsPending = (partsNeeded || partsOrdered) && !partsReceived

  // Status: parts-pending wins over "in_progress" assumption; otherwise a thread with
  // follow-up emails that isn't complete means work has started.
  if (finalStatus !== 'closed' && partsPending) {
    finalStatus = 'waiting_parts'
  } else if (finalStatus !== 'closed' && messages.length > 1) {
    finalStatus = 'in_progress'
  }

  // Archived threads with no explicit "Complete" keyword still need a completion date
  // so they show up in dashboard counts. Fall back to the last message date.
  if (finalStatus === 'closed' && !dateCompleted) {
    const last = messages[messages.length - 1]
    const lastDateStr = last ? getHeader(last.payload?.headers ?? [], 'Date') : null
    dateCompleted = new Date(lastDateStr || Date.now()).toISOString().split('T')[0]
  }

  // Build ticket number using email date
  const ticketNumber = await buildTicketNumber(admin, msgDate, unitNumber)

  // Insert the ticket
  const { data: ticket } = await admin.from('repair_tickets').insert({
    company_id:          COMPANY_ID,
    asset_id:            assetId,
    created_by:          reporterId,
    ticket_number:       ticketNumber,
    title:               title || subject,
    description:         body.trim().slice(0, 3000) || null,
    source:              'gmail',
    priority:            'normal',
    status:              finalStatus,
    parts_needed:        partsPending && !partsOrdered,        // identified but not yet ordered
    parts_ordered:       partsOrdered || partsReceived,         // we have placed an order
    waiting_on_parts:    partsPending,                          // anything not received
    gmail_message_id:    firstMsg.id,
    gmail_thread_id:     threadId,
    date_completed:      dateCompleted,
    completed_by:        completedBy,
    // Backdate creation to email date
    created_at:          msgDate.toISOString(),
  }).select('id').single()

  if (!ticket) return 'skipped'

  // Log the first message
  await admin.from('gmail_imports').insert({
    company_id:          COMPANY_ID,
    gmail_message_id:    firstMsg.id,
    gmail_thread_id:     threadId,
    subject,
    sender:              senderEmail,
    received_at:         msgDate.toISOString(),
    body_preview:        body.slice(0, 500),
    status:              'converted',
    converted_ticket_id: ticket.id,
    detected_asset:      unitNumber,
  })

  // Log reply messages
  for (const reply of messages.slice(1)) {
    const rHeaders  = reply.payload?.headers ?? []
    const replyDate = new Date(getHeader(rHeaders, 'Date') || Date.now())
    const replyFrom = parseSender(getHeader(rHeaders, 'From'))
    const replyBody = extractBody(reply.payload)

    await admin.from('gmail_imports').insert({
      company_id:          COMPANY_ID,
      gmail_message_id:    reply.id,
      gmail_thread_id:     threadId,
      subject:             `RE: ${subject}`,
      sender:              replyFrom.email,
      received_at:         replyDate.toISOString(),
      body_preview:        replyBody.slice(0, 500),
      status:              'converted',
      converted_ticket_id: ticket.id,
      detected_asset:      unitNumber,
    })

    // Add reply as comment
    if (replyBody.trim()) {
      const authorId = await findReporter(admin, replyFrom.email)
      await admin.from('repair_ticket_comments').insert({
        ticket_id:   ticket.id,
        author_id:   authorId,
        comment:     `[Via Email] ${replyBody.trim().slice(0, 2000)}`,
        is_internal: false,
        created_at:  replyDate.toISOString(),
      })
    }
  }

  // Attach any photos / files from every message in the thread to the ticket
  for (const msg of messages) {
    await syncMessageAttachments(admin, msg.id, msg.payload, ticket.id)
  }

  // Mark original message as read
  try { await markAsRead(firstMsg.id) } catch {}

  return 'created'
}
