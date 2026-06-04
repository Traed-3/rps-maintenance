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
  markAsRead,
} from '@/lib/gmail-client'
import {
  parseSubject,
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
  errors:        string[]
}

export async function syncGmailToTickets(options: {
  historical?: boolean   // true = include 2024+ emails, false = just recent
  maxThreads?: number
}): Promise<SyncResult> {
  const admin = createAdminClient()
  const result: SyncResult = { processed: 0, created: 0, updated: 0, skipped: 0, errors: [] }

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
        else result.skipped++

      } catch (e: any) {
        result.errors.push(`Thread for msg ${msgId}: ${e.message}`)
      }
    }
  }

  return result
}

// ── Per-thread processing ─────────────────────────────────────────────────────

async function processThread(
  admin: ReturnType<typeof createAdminClient>,
  threadId: string,
  isInbox: boolean
): Promise<'created' | 'updated' | 'skipped'> {

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

  const { unitNumber, title } = parseSubject(subject)
  const { email: senderEmail } = parseSender(fromRaw)

  const assetId    = await findOrCreateAsset(admin, unitNumber)
  const reporterId = await findReporter(admin, senderEmail)
  const body       = extractBody(firstMsg.payload)

  // ── Thread already imported — process replies only ─────────────────────────
  if (existing?.converted_ticket_id) {
    const ticketId = existing.converted_ticket_id
    let updated = false

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
        updates.status         = 'closed'
        updates.date_completed = new Date(getHeader(replyHeaders, 'Date') || Date.now()).toISOString().split('T')[0]
      } else if (status.partsReceived) {
        updates.parts_ordered     = true
        updates.waiting_on_parts  = false
      } else if (status.partsOrdered) {
        updates.parts_needed   = true
        updates.parts_ordered  = true
        updates.waiting_on_parts = true
        updates.status         = 'waiting_parts'
      }

      if (Object.keys(updates).length) {
        await admin.from('repair_tickets').update(updates).eq('id', ticketId)
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
    }

    return updated ? 'updated' : 'skipped'
  }

  // ── New thread — create ticket ─────────────────────────────────────────────

  // Determine initial status from ALL messages
  let finalStatus: string = isInbox ? 'open' : 'closed'
  let partsOrdered  = false
  let partsReceived = false
  let dateCompleted: string | null = null

  for (const msg of messages) {
    const s = detectStatus(extractBody(msg.payload))
    if (s.isComplete) {
      finalStatus  = 'closed'
      dateCompleted = new Date(getHeader(msg.payload?.headers ?? [], 'Date') || Date.now())
        .toISOString().split('T')[0]
    }
    if (s.partsOrdered)  partsOrdered  = true
    if (s.partsReceived) partsReceived = true
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
    parts_needed:        partsOrdered || partsReceived,
    parts_ordered:       partsOrdered || partsReceived,
    waiting_on_parts:    partsOrdered && !partsReceived,
    gmail_message_id:    firstMsg.id,
    gmail_thread_id:     threadId,
    date_completed:      dateCompleted,
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

  // Mark original message as read
  try { await markAsRead(firstMsg.id) } catch {}

  return 'created'
}
