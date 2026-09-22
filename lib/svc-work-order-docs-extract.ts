/**
 * Claude draft-transcription for completed-ticket photos/scans captured off
 * rpinvoicing (see svc-gmail-sync.ts's captureWorkOrderDocument). This is a
 * DRAFT only — the transcript here pre-fills the review queue's editable
 * text, and manager_signature_visible is a hint shown to the reviewer, never
 * treated as verified. A human always sets svc_work_order_documents.
 * manager_signature_verified themselves before anything can be marked ready.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { WORK_ORDER_DOCS_BUCKET } from '@/lib/svc-gmail-sync'

const EXTRACT_MODEL = process.env.BILLING_EXTRACT_MODEL ?? 'claude-sonnet-5'
const FALLBACK_MODEL = 'claude-sonnet-4-6'

const RECORD_TOOL: Anthropic.Tool = {
  name: 'record_ticket',
  description: 'Transcribe the completed field service ticket exactly as written.',
  input_schema: {
    type: 'object',
    properties: {
      transcript: { type: 'string', description: 'Everything handwritten or printed on the ticket, in reading order: site/customer, date, description of work performed, parts or materials used, hours. Transcribe faithfully — do not summarize or clean up wording.' },
      technician_name: { type: ['string', 'null'], description: 'The technician’s name as written, if legible' },
      work_date: { type: ['string', 'null'], description: 'YYYY-MM-DD if a date is legible on the ticket' },
      manager_signature_visible: { type: 'boolean', description: 'True only if you can see a second, distinct signature/initials on a line labeled manager, supervisor, or approved-by — separate from the technician’s own signature. False if unsure.' },
      notes: { type: ['string', 'null'], description: 'Anything illegible, missing, or worth a human double-checking' },
    },
    required: ['transcript', 'manager_signature_visible'],
  },
}

const SYSTEM = `You read scanned/photographed completed field-service tickets for Rappahannock Petroleum Services (RPS), a petroleum equipment contractor. These are paper tickets a technician fills out by hand after finishing a job, then photographs or scans and emails in.
Transcribe everything on the ticket exactly as written — do not paraphrase, clean up, or infer anything not actually on the page. If handwriting is ambiguous, transcribe your best reading and flag the uncertainty in notes rather than guessing silently. A ticket usually has the technician's own signature; only report manager_signature_visible as true if there is a SEPARATE signature or initials specifically on a manager/supervisor/approved-by line. Return only the record_ticket tool call.`

function mediaTypeFor(att: { name: string; mime: string }): { block: 'document' | 'image'; media: string } | null {
  const m = att.mime.toLowerCase(), n = att.name.toLowerCase()
  if (m === 'application/pdf' || n.endsWith('.pdf')) return { block: 'document', media: 'application/pdf' }
  if (/^image\/(jpeg|jpg)$/.test(m) || /\.jpe?g$/.test(n)) return { block: 'image', media: 'image/jpeg' }
  if (m === 'image/png' || n.endsWith('.png')) return { block: 'image', media: 'image/png' }
  if (m === 'image/gif' || n.endsWith('.gif')) return { block: 'image', media: 'image/gif' }
  if (m === 'image/webp' || n.endsWith('.webp')) return { block: 'image', media: 'image/webp' }
  if (m === 'image/heic' || n.endsWith('.heic')) return null // Claude can't read HEIC directly — flagged as unreadable below
  return null
}

export type TicketExtracted = {
  transcript: string
  technician_name: string | null
  work_date: string | null
  manager_signature_visible: boolean
  notes: string | null
  model?: string
}

/** Run Claude over one document's attachments and store the draft transcript. */
export async function extractWorkOrderDocument(docId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient()
  const { data: doc } = await admin.from('svc_work_order_documents').select('*').eq('id', docId).single()
  if (!doc) return { ok: false, error: 'not found' }
  if (!process.env.ANTHROPIC_API_KEY) {
    await admin.from('svc_work_order_documents').update({ extract_status: 'failed', extract_error: 'ANTHROPIC_API_KEY is not set' }).eq('id', docId)
    return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  }

  const atts = (doc.attachments as { name: string; mime: string; path: string; size: number }[]).map(a => ({ a, kind: mediaTypeFor(a) })).filter(x => x.kind).slice(0, 4)
  if (!atts.length) {
    await admin.from('svc_work_order_documents').update({ extract_status: 'skipped', extract_error: 'No readable attachment (PDF/JPEG/PNG/GIF/WEBP) — type up the ticket by hand.' }).eq('id', docId)
    return { ok: false, error: 'no readable attachment' }
  }

  const content: Anthropic.ContentBlockParam[] = []
  let budget = 20 * 1024 * 1024
  for (const { a, kind } of atts) {
    const { data, error } = await admin.storage.from(WORK_ORDER_DOCS_BUCKET).download(a.path)
    if (error || !data) continue
    const buf = Buffer.from(await data.arrayBuffer())
    if (buf.length > budget) continue
    budget -= buf.length
    content.push({ type: 'text', text: `Attachment: ${a.name}` })
    if (kind!.block === 'document') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
    else content.push({ type: 'image', source: { type: 'base64', media_type: kind!.media as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: buf.toString('base64') } })
  }
  if (!content.length) {
    await admin.from('svc_work_order_documents').update({ extract_status: 'skipped', extract_error: 'Could not download any attachment for reading.' }).eq('id', docId)
    return { ok: false, error: 'no downloadable attachment' }
  }
  content.push({ type: 'text', text: `Email subject: ${doc.subject ?? ''}\nFrom: ${doc.sender ?? ''} <${doc.sender_email ?? ''}>\n\nTranscribe this completed ticket with record_ticket.` })

  const client = new Anthropic()
  const call = (model: string) => client.messages.create({ model, max_tokens: 4000, system: SYSTEM, tools: [RECORD_TOOL], tool_choice: { type: 'tool', name: 'record_ticket' }, messages: [{ role: 'user', content }] })
  let model = EXTRACT_MODEL
  let response: Anthropic.Message
  try {
    try { response = await call(model) }
    catch (e) {
      const msg = (e as Error).message
      if (/not_found|model/i.test(msg) && model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; response = await call(model) } else throw e
    }
  } catch (e) {
    await admin.from('svc_work_order_documents').update({ extract_status: 'failed', extract_error: (e as Error).message.slice(0, 500) }).eq('id', docId)
    return { ok: false, error: (e as Error).message }
  }

  const tool = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  if (!tool) {
    await admin.from('svc_work_order_documents').update({ extract_status: 'failed', extract_error: 'Model returned no record' }).eq('id', docId)
    return { ok: false, error: 'no tool call' }
  }
  const raw = tool.input as TicketExtracted
  const extracted: TicketExtracted = { ...raw, model }

  const updates: Record<string, unknown> = { extracted, extract_status: 'done', extract_error: null }
  // Only pre-fill the editable transcript / advance the status on the first
  // pass — never overwrite a human's own edits if this is somehow re-run.
  if (doc.status === 'new') {
    updates.transcript = raw.transcript ?? null
    updates.status = 'needs_review'
  }
  await admin.from('svc_work_order_documents').update(updates).eq('id', docId)
  return { ok: true }
}

/** Extract the oldest pending documents (bounded so a cron tick stays inside its time budget). */
export async function extractPendingWorkOrderDocuments(limit = 5): Promise<{ processed: number; ok: number; errors: string[] }> {
  const admin = createAdminClient()
  const { data: pending } = await admin.from('svc_work_order_documents').select('id').eq('extract_status', 'pending').order('created_at').limit(limit)
  const out = { processed: 0, ok: 0, errors: [] as string[] }
  for (const row of pending ?? []) {
    out.processed++
    const r = await extractWorkOrderDocument(row.id)
    if (r.ok) out.ok++
    else if (r.error) out.errors.push(`${row.id}: ${r.error}`)
  }
  return out
}
