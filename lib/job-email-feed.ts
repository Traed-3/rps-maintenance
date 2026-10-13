/**
 * Job email feed — keeps each construction job current from the mail that already flows through the RPS inboxes.
 * Runs as `pass=updates` on the inbox-sync route (every 15 minutes with the Gmail sync).
 *
 *   1. Tech updates  (econstruction, "38646 update hydrx stage 1" from a *.rp@gmail.com tech, photos attached)
 *        → con_daily_updates row on the job (work_date, description) + the photos as con_documents.
 *   2. Field tickets (rpinvoicing, handwritten ticket photo with "(x<crew>)" in the subject)
 *        → the existing backfillFieldTicketsForJob() pairs them with the typed update and files a needs_review draft.
 *   3. Invoice workups (Peggy → econstruction, "40043 Invoice Wire Pull" + the .xlsx, Starsky and Star reply in-thread)
 *        → the workbook lands on the job under Invoices, the job moves to Need Invoiced, and Star's
 *          "Received. Will move to IRTS with tickets" reply moves it to Complete (Trae 9/30/26: that loop = finished and invoiced).
 *
 * Every step is idempotent: updates dedupe on the Gmail message id (and on day + subject for Starsky's re-forwards),
 * invoices dedupe on the inbox document's storage path, tickets dedupe inside the backfill.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { listMessages, getMessage, getThread, getAttachment, listAttachments, header, parseAddress, extractText, connectedInboxes } from '@/lib/billing-gmail-client'
import { stripQuoted, INBOX_BUCKET, type ThreadReply } from '@/lib/billing-inbox-sync'
import { backfillFieldTicketsForJob } from '@/lib/field-ticket-gmail-match'
import { woTokens } from '@/lib/svc-construction-link'

const DOCS_BUCKET = 'construction-docs'
const MAX_PHOTO_BYTES = 12 * 1024 * 1024
const MAX_PHOTOS_PER_UPDATE = 6
const MAX_UPDATES_PER_PASS = 4
/** Each pass stops starting new work after this many ms and finishes on the next tick — kept well under the route's 300 s so one pass doesn't burn a mailbox's per-minute Gmail quota. */
const PASS_BUDGET_MS = 40_000
const MAX_TICKET_JOBS_PER_PASS = 3
const PHOTO_MIME = /^image\/(jpeg|jpg|png|heic|heif|webp)$/i
const PHOTO_EXT = /\.(jpe?g|png|heic|heif|webp)$/i
const RPS_TECH = /@rappahannockpetroleum\.com$|\.rp@gmail\.com$|^econstruction\.rp@gmail\.com$/i
const NOISE_SUBJECT = /action required|work order|status updates|shared folders|returns spreadsheet|packing slip|invoice/i

type Budget = { deadline: number }
const over = (b?: Budget) => !!b && Date.now() > b.deadline

export type FeedResult = {
  updates: { filed: number; skipped: number; unmatched: string[]; errors: string[]; budget_hit?: boolean }
  tickets: { jobs: number; filed: number; created: string[]; paired: string[]; needs_wo: string[]; unmatched: string[]; errors: string[]; budget_hit?: boolean }
  invoices: { filed: number; completed: number; unmatched: string[]; errors: string[]; budget_hit?: boolean }
  orders: { sent: number; po: number; replied: number; errors: string[]; budget_hit?: boolean }
}

type Job = { id: string; company_id: string; site_number: string | null; work_order_number: string | null; stage: string; status_detail: string | null; updated_at: string | null }

/** "Re: Fwd: SU-9901 update MUL boots" -> ["SU-9901"]; "Fwd: SD- 40043 -6.5(x3)" -> ["40043"]; "45967/58802 Invoice Wire Pull" -> ["45967","58802"]; "Wawa 8659 Update" -> ["Wawa 8659","8659"]. */
export function siteKeysFromSubject(subject: string): string[] {
  // Techs sometimes lead with the word: "Update SU 9901", "UPDATE 32361". "SD- 40043 -6.5(x3)" = sent on by
  // Starsky Dodson (his initials, Trae 10/13/26), not a site prefix.
  const head = subject.replace(/^\s*(?:(?:re|fwd?)\s*:\s*)+/i, '').replace(/^SD\s*-\s*(?=\S)/i, '').replace(/^update\s*[:\-]?\s+(?=\S)/i, '').trim()
  let m = head.match(/^((?:SU|IP|CP|CPG|F)\s*-?\s*\d{3,5})\b/i)
  if (m) { const p = m[1].toUpperCase().replace(/\s+/g, ''); return [p.startsWith('IP') ? p.replace('-', '') : p.replace(/^(SU|CP|CPG|F)-?/, '$1-')] }
  m = head.match(/^((?:Wawa|Global|Sheetz|Sunoco|Royal Farms|Handy Mart)\s*#?\s*(\d{2,5}))\b/i)
  if (m) return [m[1].replace(/\s+/g, ' '), m[2]]
  m = head.match(/^(\d{4,5}(?:\s*\/\s*\d{4,5})*)\b/)
  if (m) return m[1].split('/').map(s => s.trim())
  return []
}

/** The open job for a site; a completed one only when `allowComplete` (an invoice can trail completion). */
export async function findJobForKeys(admin: ReturnType<typeof createAdminClient>, keys: string[], allowComplete = false): Promise<Job | null> {
  if (!keys.length) return null
  const ors = keys.flatMap(k => [`site_number.ilike.${k}`, `site_number.ilike.${k} (%`, `site_number.ilike.% ${k}`, `site_number.ilike.${k}/%`, `site_number.ilike.%/${k}`]).join(',')
  const { data } = await admin.from('con_jobs').select('id, company_id, site_number, work_order_number, stage, status_detail, updated_at').or(ors).order('updated_at', { ascending: false }).limit(20)
  const rows = (data ?? []) as Job[]
  const rank = (j: Job) => ['in_progress', 'scheduled', 'return_needed', 'needs_scheduled', 'on_hold', 'material_ordering', 'close_out', 'invoicing', 'permitting', 'quoting', 'survey', 'overspill_program'].indexOf(j.stage)
  const open = rows.filter(j => j.stage !== 'complete').sort((a, b) => (rank(a) === -1 ? 99 : rank(a)) - (rank(b) === -1 ? 99 : rank(b)))
  if (open.length) return open[0]
  return allowComplete ? rows[0] ?? null : null
}

function ymdET(internalDate?: string): string {
  const d = internalDate ? new Date(Number(internalDate)) : new Date()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
const subjectKey = (s: string) => s.replace(/^\s*(?:(?:re|fwd?)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** 1. Typed tech updates → con_daily_updates + photos. */
export async function syncTechUpdates(opts: { sinceDays?: number; budget?: Budget } = {}): Promise<FeedResult['updates']> {
  const out: FeedResult['updates'] = { filed: 0, skipped: 0, unmatched: [], errors: [] }
  if (!connectedInboxes().includes('econstruction')) { out.errors.push('econstruction not connected'); return out }
  const admin = createAdminClient()
  const days = opts.sinceDays ?? 3
  let ids: string[]
  try { ids = await listMessages('econstruction', `newer_than:${days}d subject:update -subject:"Action Required" -subject:"Work Order" -subject:"Status Updates" -from:no-reply`, 40) }
  catch (e) { out.errors.push(`list: ${(e as Error).message}`); return out }
  let filedThisPass = 0
  for (const id of ids) {
    if (filedThisPass >= MAX_UPDATES_PER_PASS) break
    if (over(opts.budget)) { out.budget_hit = true; break }
    try {
      const { data: dup } = await admin.from('con_daily_updates').select('id').contains('source_refs', { update_message_id: id }).maybeSingle()
      if (dup) { out.skipped++; continue }
      const msg = await getMessage('econstruction', id)
      const subject = header(msg, 'Subject')
      const from = parseAddress(header(msg, 'From'))
      if (NOISE_SUBJECT.test(subject) || !RPS_TECH.test(from.email) || !/update/i.test(subject)) { out.skipped++; continue }
      const keys = siteKeysFromSubject(subject)
      const job = await findJobForKeys(admin, keys)
      if (!job) { out.unmatched.push(subject); continue }
      const workDate = ymdET(msg.internalDate)
      const skey = subjectKey(subject)
      // Starsky re-forwards a tech's update (sometimes with the site number fixed): same day + same wording = same update.
      const { data: twin } = await admin.from('con_daily_updates').select('id').eq('job_id', job.id).eq('work_date', workDate).contains('source_refs', { subject_key: skey }).maybeSingle()
      if (twin) { out.skipped++; continue }
      const body = stripQuoted(extractText(msg)) || '(photos only)'
      // Starsky re-forwards a tech's update with the site number fixed (a different subject, so the check
      // above misses it) — and the tech's original, carrying the wrong site, can resolve to some other job.
      // Same day + identical text anywhere = the same update, so file it once.
      if (body !== '(photos only)') {
        const { data: sameText } = await admin.from('con_daily_updates').select('id, job_id').eq('company_id', job.company_id).eq('work_date', workDate).eq('source', 'gmail_update').eq('work_description', body.slice(0, 4000)).limit(1)
        const prior = sameText?.[0]
        if (prior) {
          // The office's own forward carries the corrected site: if the original already landed on a different
          // job, move it (and its photos) to the right one instead of leaving it on the wrong job.
          // Trust the SENT label (set by Gmail only on mail this mailbox sent), not the spoofable From header.
          if (prior.job_id !== job.id && msg.labelIds?.includes('SENT')) {
            await admin.from('con_daily_updates').update({ job_id: job.id }).eq('id', prior.id).eq('company_id', job.company_id)
            await admin.from('con_documents').update({ job_id: job.id }).eq('daily_update_id', prior.id).eq('company_id', job.company_id)
          }
          out.skipped++; continue
        }
      }
      const { data: du, error: duErr } = await admin.from('con_daily_updates').insert({
        company_id: job.company_id, job_id: job.id, work_date: workDate, work_description: body.slice(0, 4000),
        notes: `Emailed to econstruction by ${from.name || from.email} · "${subject}"`,
        review_status: 'filed', source: 'gmail_update',
        source_refs: { update_message_id: id, thread_id: msg.threadId, subject, subject_key: skey, from_email: from.email },
      }).select('id').single()
      if (duErr || !du) throw new Error(duErr?.message ?? 'insert failed')
      const photos = listAttachments(msg).filter(a => (PHOTO_MIME.test(a.mimeType) || PHOTO_EXT.test(a.filename)) && a.size <= MAX_PHOTO_BYTES).slice(0, MAX_PHOTOS_PER_UPDATE)
      for (const a of photos) {
        const bytes = await getAttachment('econstruction', id, a.attachmentId)
        const path = `${job.company_id}/${job.id}/daily/${workDate}-${id}-${safeName(a.filename)}`
        const { error: upErr } = await admin.storage.from(DOCS_BUCKET).upload(path, bytes, { contentType: a.mimeType, upsert: true })
        if (upErr) { out.errors.push(`${subject}: photo ${a.filename}: ${upErr.message}`); continue }
        await admin.from('con_documents').insert({
          company_id: job.company_id, job_id: job.id, daily_update_id: du.id, file_name: a.filename, original_filename: a.filename, storage_path: path,
          category: 'photos', doc_type: 'photo', review_status: 'filed', imported_by: 'gmail_update_feed', imported_at: new Date().toISOString(),
        })
      }
      out.filed++; filedThisPass++
    } catch (e) {
      out.errors.push(`${id}: ${(e as Error).message}`)
    }
  }
  return out
}

/** A ticket this soon after the site's last job closed is a trailing ticket for that job, not new work. */
const LATE_TICKET_DAYS = 14
export const DRAFT_JOB_STATUS = 'Draft — started automatically from a field ticket; confirm scope, customer and stage'

/** A service call dispatched this long before a ticket can still be the work it authorizes. */
const AUTH_LOOKBACK_DAYS = 60
type GmailMsg = Awaited<ReturnType<typeof getMessage>>
type TicketAuth = { wo: string | null; source: string; candidates: string[] }

const ownWoTokens = (msg: GmailMsg) => woTokens(`${header(msg, 'Subject')}\n${extractText(msg)}`)

/**
 * WO#s on the ticket email, else in its thread (Starsky files tickets under the portal WO thread). Anyone can reply
 * into a thread by matching the subject, so a thread message only counts when its sender is verified.
 * Callers have already verified the ticket's own sender.
 */
async function ticketWoTokens(admin: ReturnType<typeof createAdminClient>, msg: GmailMsg): Promise<string[]> {
  const own = ownWoTokens(msg)
  if (own.length || !msg.threadId) return own
  const thread = await getThread('rpinvoicing', msg.threadId)
  const texts: string[] = []
  for (const m of thread.messages) if (m.id !== msg.id && await isTrustedWoSender(admin, m)) texts.push(`${header(m, 'Subject')}\n${extractText(m)}`)
  return woTokens(texts.join('\n'))
}

/** Master Schedule rows this far either side of a ticket can be the job it belongs to. */
const SCHEDULE_WINDOW_DAYS = 120
/** RPS's own mailboxes that forward work orders (the service department's dispatcher and invoicing inboxes). */
const COMPANY_MAILBOXES = new Set(['rpdispatcher@gmail.com', 'rpinvoicing@gmail.com', 'econstruction.rp@gmail.com'])
const day = (ymd: string, offsetDays: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + offsetDays * 86_400_000).toISOString()
const distinct = (xs: string[]) => { const seen = new Map<string, string>(); for (const x of xs) if (!seen.has(x.trim().toUpperCase())) seen.set(x.trim().toUpperCase(), x.trim()); return [...seen.values()] }

const NAME_WORD = String.raw`(?:[A-Z][a-z']+\.?|[A-Z]\.?|[A-Z]{2,4})`
const AUTHORIZER = new RegExp(String.raw`^${NAME_WORD}(?:\s+${NAME_WORD}){0,2}(?:\s*-\s*${NAME_WORD})?(?:\s*\(?\+?[\d\s().-]{7,}\)?)?$`)
const PERSON_THEN_NOTE = /^[A-Z][a-z']+(?:\s+[A-Z][a-z']*\.?){0,2}\s+-\s+\S/
/**
 * A W/O cell that records an authorization: a WO#, or the person who gave it ("John M", "Katina Walters",
 * "Joel Silver (304-582-2490)", "PF - PE") — not a scope note Starsky parked there ("Disp replacement x 2").
 */
export function isAuthorization(wo: string): boolean {
  const v = wo.trim()
  // "Kevin Rickard - Patriot clean fuel", "Liz - Needs repiped": a real (mixed-case) name ahead of a note.
  return woTokens(v).length > 0 || AUTHORIZER.test(v) || PERSON_THEN_NOTE.test(v)
}

/**
 * 1. Starsky's Master Schedule — the W/O column for the site (a WO# or the name of whoever authorized the work), from
 * the running history the office Mac keeps (con_master_schedule_log; the sheet itself is rewritten daily). Rows still
 * on the sheet win; otherwise the rows seen nearest the ticket. One distinct W/O is the answer; more is a choice.
 */
async function scheduleAuthorization(admin: ReturnType<typeof createAdminClient>, keys: string[], ticketDate: string): Promise<{ wo: string | null; candidates: string[] }> {
  const { data, error } = await admin.from('con_master_schedule_log').select('wo, on_sheet, last_seen_at')
    .overlaps('site_tokens', keys).not('wo', 'is', null)
    .gte('last_seen_at', day(ticketDate, -SCHEDULE_WINDOW_DAYS)).lte('first_seen_at', day(ticketDate, SCHEDULE_WINDOW_DAYS))
    .order('last_seen_at', { ascending: false }).limit(20)
  const rows = (data ?? []).filter(r => isAuthorization(r.wo as string))
  if (error || !rows.length) return { wo: null, candidates: [] }   // table not created yet, or nothing logged for the site
  const live = rows.filter(r => r.on_sheet)
  const pool = distinct((live.length ? live : rows.filter(r => r.last_seen_at === rows[0].last_seen_at)).map(r => r.wo as string))
  return pool.length === 1 ? { wo: pool[0], candidates: [] } : { wo: null, candidates: distinct(rows.map(r => r.wo as string)) }
}

/**
 * 3. Work orders forwarded to econstruction for the site — by the service department or a customer. A WO# counts
 * as fact only from a sender Gmail verified as RPS (staff or an RPS mailbox) or the customer's ticketing system
 * (service-now); a WO# in anyone else's email is offered as a choice, since anyone can email econstruction.
 */
async function econstructionAuthorization(admin: ReturnType<typeof createAdminClient>, keys: string[], ticketDate: string): Promise<{ wo: string | null; candidates: string[]; errors: string[] }> {
  if (!connectedInboxes().includes('econstruction')) return { wo: null, candidates: [], errors: [] }
  const terms = keys.map(k => `"${k.replace(/"/g, '')}"`).join(' OR ')
  const after = day(ticketDate, -SCHEDULE_WINDOW_DAYS).slice(0, 10).replace(/-/g, '/')
  const trusted: string[] = [], other: string[] = [], errors: string[] = []
  let ids: string[] = []
  try { ids = await listMessages('econstruction', `(${terms}) (WOT OR FWKD OR "work order") after:${after}`, 10) } catch (e) { return { wo: null, candidates: [], errors: [`econstruction search: ${(e as Error).message}`] } }
  for (const id of ids) {
    try {
      const msg = await getMessage('econstruction', id)
      const text = `${header(msg, 'Subject')}\n${extractText(msg)}`
      if (!keys.some(k => text.includes(k))) continue
      const toks = woTokens(text)
      if (!toks.length) continue
      ;(await isTrustedWoSender(admin, msg) ? trusted : other).push(...toks)
    } catch (e) { errors.push(`econstruction ${id}: ${(e as Error).message}`) }
  }
  const sure = distinct(trusted)
  return sure.length === 1 ? { wo: sure[0], candidates: [], errors } : { wo: null, candidates: distinct([...sure, ...other]), errors }
}

/**
 * Where a ticket's work was authorized, checked in Trae's order (10/13/26):
 *   1. the Master Schedule W/O for the site (WO# or who authorized it),
 *   2. a WO# written on the ticket or its thread — only when the ticket's sender is verified staff,
 *   3. work orders forwarded to econstruction by the service department or a customer,
 *   4. service calls at the site in the 60 days before — suggestions only: busy sites get many routine calls, and a
 *      wrong WO# on a job makes that call follow the job (svc-construction-link) and hides its own completion.
 */
async function ticketAuthorization(
  admin: ReturnType<typeof createAdminClient>, msg: GmailMsg, keys: string[], ticketDate: string, senderVerified: boolean,
): Promise<TicketAuth & { errors: string[] }> {
  if (!keys.length) return { wo: null, source: 'no site number', candidates: [], errors: [] }
  const sched = await scheduleAuthorization(admin, keys, ticketDate)
  if (sched.wo) return { wo: sched.wo, source: 'Master Schedule W/O', candidates: [], errors: [] }
  if (senderVerified) {
    const tokens = await ticketWoTokens(admin, msg)
    if (tokens.length) return { wo: tokens.join(' - '), source: 'WO# on the ticket email', candidates: [], errors: [] }
  }
  const econ = await econstructionAuthorization(admin, keys, ticketDate)
  if (econ.wo) return { wo: econ.wo, source: 'work order forwarded to econstruction', candidates: [], errors: econ.errors }
  const { data: calls } = await admin.from('svc_work_orders').select('portal_wo_number')
    .or(keys.map(k => `site_number.ilike.${k}`).join(',')).not('portal_wo_number', 'is', null)
    .gte('dispatched_at', day(ticketDate, -AUTH_LOOKBACK_DAYS)).lte('dispatched_at', `${ticketDate}T23:59:59Z`).order('dispatched_at', { ascending: false }).limit(10)
  const candidates = distinct([...sched.candidates, ...econ.candidates, ...(calls ?? []).map(c => c.portal_wo_number as string)])
  return {
    wo: null, errors: econ.errors, candidates,
    source: candidates.length ? 'nothing certain on the Master Schedule, the ticket or econstruction — possible' : 'not on the Master Schedule, the ticket, econstruction or a recent service call',
  }
}

/** The job already carrying one of these WO#s (the ticket names its WO, so that beats a site-number match). */
async function findJobForWo(admin: ReturnType<typeof createAdminClient>, tokens: string[]): Promise<Job | null> {
  for (const wo of tokens) {
    const { data } = await admin.from('con_jobs').select('id, company_id, site_number, work_order_number, stage, status_detail, updated_at')
      .ilike('work_order_number', `%${wo}%`).neq('stage', 'complete').order('updated_at', { ascending: false }).limit(1)
    if (data?.length) return data[0] as Job
  }
  return null
}

const needsWoNote = (a: TicketAuth) => `Needs WO# / authorization — ${a.source}${a.candidates.length ? `: ${a.candidates.join(', ')}` : ''}`

/**
 * A field ticket for a site with no open job: start the job as a draft so the ticket has somewhere to land
 * (Trae 10/13/26: tickets were silently dropped when nobody had opened the project yet). Fills site, address
 * and brand from con_sites when the site is known; the office confirms the rest.
 */
/**
 * Gmail's own verdict (an mx.google.com Authentication-Results header — a sender can add their own, so others are
 * ignored) shows DMARC pass aligned to this exact address's domain. Combined with an exact staff address, that is
 * what stops anyone who can email rpinvoicing from opening a job with a crafted "12345 (x2)" subject.
 */
/**
 * The one address in the one From header, or null. Gmail hands back decoded header values, so a display name can
 * carry an address of its own ("Trae <tdodson.rp@gmail.com>" encoded into the name, then the real sender) — anything
 * with more than one "@", more than one From header, or a group/comment form is refused rather than parsed.
 */
export function singleFromAddress(msg: { payload?: { headers?: { name: string; value: string }[] } }): string | null {
  const froms = (msg.payload?.headers ?? []).filter(h => h.name.toLowerCase() === 'from')
  if (froms.length !== 1) return null
  const raw = froms[0].value.trim()
  if ((raw.match(/@/g) ?? []).length !== 1) return null
  const m = raw.match(/^(?:"[^"<>@]*"|[^"<>@,;:()]*)\s*<([^\s<>@",;:()]+@[^\s<>@",;:()]+)>$/) ?? raw.match(/^([^\s<>@",;:()]+@[^\s<>@",;:()]+)$/)
  return m ? m[1].toLowerCase() : null
}

function isAuthenticatedSender(msg: { payload?: { headers?: { name: string; value: string }[] } }, email: string): boolean {
  if (!/^[^\s@,<>"]+@[^\s@,<>"]+$/.test(email)) return false
  const domain = email.split('@')[1]
  const verdicts = (msg.payload?.headers ?? [])
    .filter(h => h.name.toLowerCase() === 'authentication-results' && /^\s*mx\.google\.com\b/i.test(h.value))
    .map(h => h.value)
  if (!verdicts.length) return false
  const aligned = new RegExp(`\\bdmarc=pass\\b[^;]*header\\.from=${domain.replace(/[^a-z0-9]/gi, c => '\\' + c)}\\b`, 'i')
  return verdicts.every(v => aligned.test(v))
}

/** Null when the ticket comes from an active staff address Gmail verified; otherwise why not. Gates every write a ticket can cause. */
async function staffSenderProblem(admin: ReturnType<typeof createAdminClient>, msg: GmailMsg): Promise<string | null> {
  const m = msg as { payload?: { headers?: { name: string; value: string }[] } }
  const from = singleFromAddress(m)
  if (!from) return 'From header is not a single plain address'
  // Exact comparison in code — PostgREST's ilike treats * as a wildcard, so a pattern match could be steered.
  const { data: staff } = await admin.from('profiles').select('email').eq('is_active', true).not('email', 'is', null)
  if (!(staff ?? []).some(p => (p.email as string).trim().toLowerCase() === from)) return `sender ${from} is not an active staff address`
  if (!isAuthenticatedSender(m, from)) return `sender ${from} not verified by Gmail (DMARC)`
  return null
}

/**
 * Mail whose WO# can be taken as fact: Gmail verified (DMARC aligned, mx.google.com verdict) that it really came from
 * RPS — an active staff address or one of the company mailboxes — or from the customer's ticketing system
 * (service-now). Everyone else's WO# is only offered as a choice.
 */
async function isTrustedWoSender(admin: ReturnType<typeof createAdminClient>, msg: GmailMsg): Promise<boolean> {
  const m = msg as { payload?: { headers?: { name: string; value: string }[] } }
  const from = singleFromAddress(m)
  if (!from || !isAuthenticatedSender(m, from)) return false
  if (COMPANY_MAILBOXES.has(from) || /@service-now\.com$/.test(from)) return true
  return !(await staffSenderProblem(admin, msg))
}

async function createDraftJobForTicket(
  admin: ReturnType<typeof createAdminClient>, msg: GmailMsg, messageId: string,
  keys: string[], subject: string, internalDate: string | undefined, auth: TicketAuth,
): Promise<{ job: Job; reason?: undefined } | { job?: undefined; reason: string }> {
  const ticketDate = ymdET(internalDate)
  // Service techs use the same "(x2)" subject, so a ticket the service sync already tied to a call, or one for a
  // site with a live (or just-finished) service call, is a service ticket — never a new construction job.
  const { data: svcDoc } = await admin.from('svc_work_order_documents').select('id').eq('gmail_message_id', messageId).not('work_order_id', 'is', null).limit(1)
  if (svcDoc?.length) return { reason: 'service ticket (matched to a service call)' }
  const recent = new Date(Date.now() - LATE_TICKET_DAYS * 86_400_000).toISOString()
  const { data: svcCalls } = await admin.from('svc_work_orders').select('id, status, completed_at').eq('archived', false)
    .or(keys.map(k => `site_number.ilike.${k}`).join(',')).limit(20)
  if ((svcCalls ?? []).some(w => w.status !== 'completed' || (w.completed_at && w.completed_at > recent))) {
    return { reason: 'service call open or just completed at this site — treated as a service ticket' }
  }
  const last = await findJobForKeys(admin, keys, true)
  if (last?.stage === 'complete' && last.updated_at && Date.now() - new Date(last.updated_at).getTime() < LATE_TICKET_DAYS * 86_400_000) {
    return { reason: `job at ${last.site_number} closed ${last.updated_at.slice(0, 10)} — late ticket, file it by hand` }
  }
  const { data: sites } = await admin.from('con_sites').select('id, company_id, site_number, store_brand, address, city, state')
    .or(keys.map(k => `site_number.ilike.${k}`).join(',')).limit(2)
  const site = sites?.length === 1 ? sites[0] : null
  let companyId = site?.company_id as string | undefined
  if (!companyId) {
    const { data: companies } = await admin.from('companies').select('id').limit(2)
    if (companies?.length !== 1) return { reason: 'site not on file and more than one company — start the job by hand' }
    companyId = companies[0].id as string
  }
  const { data: job, error } = await admin.from('con_jobs').insert({
    company_id: companyId,
    site_id: site?.id ?? null,
    site_number: site?.site_number ?? keys[0],
    stage: 'in_progress',
    work_order_number: auth.wo,
    status_detail: auth.wo ? `${DRAFT_JOB_STATUS}. WO# from ${auth.source}` : `${DRAFT_JOB_STATUS}. ${needsWoNote(auth)}`,
    facility_address: site ? [site.address, site.city, site.state].filter(Boolean).join(', ') || null : null,
    gas_brand: site?.store_brand ?? null,
    date_received: ticketDate,
    project_start_date: ticketDate,
    notes: `Opened by the email sync from rpinvoicing field ticket "${subject}" (${ticketDate}).`,
  }).select('id, company_id, site_number, work_order_number, stage, status_detail, updated_at').single()
  if (error || !job) return { reason: `could not create job: ${error?.message ?? 'insert failed'}` }
  return { job: job as Job }
}

/** 2. New handwritten tickets in rpinvoicing → the existing per-job backfill (OCR + needs_review draft), a few jobs per pass.
 *  A ticket for a site with no open job starts a draft job first (createDraftJobForTicket). */
export async function syncFieldTickets(opts: { sinceDays?: number; budget?: Budget } = {}): Promise<FeedResult['tickets']> {
  const out: FeedResult['tickets'] = { jobs: 0, filed: 0, created: [], paired: [], needs_wo: [], unmatched: [], errors: [] }
  if (!connectedInboxes().includes('rpinvoicing')) { out.errors.push('rpinvoicing not connected'); return out }
  const admin = createAdminClient()
  let ids: string[]
  try { ids = await listMessages('rpinvoicing', `newer_than:${opts.sinceDays ?? 3}d "(x"`, 40) } catch (e) { out.errors.push(`list: ${(e as Error).message}`); return out }
  const jobs = new Map<string, Job>()
  for (const id of ids) {
    if (jobs.size >= MAX_TICKET_JOBS_PER_PASS) break
    try {
      const msg = await getMessage('rpinvoicing', id)
      const subject = header(msg, 'Subject')
      if (!/\(x\d+\)/i.test(subject)) continue
      const { data: seen } = await admin.from('con_daily_updates').select('id').contains('source_refs', { ticket_message_id: id }).maybeSingle()
      if (seen) continue
      const keys = siteKeysFromSubject(subject)
      let job = (await findJobForWo(admin, ownWoTokens(msg))) ?? (await findJobForKeys(admin, keys))
      const date = ymdET(msg.internalDate)
      if (!job && keys.length) {
        // Only a verified staff ticket may open a job (anyone can email rpinvoicing).
        const problem = await staffSenderProblem(admin, msg)
        if (problem) out.unmatched.push(`${subject} (${problem})`)
        else {
          const auth = await ticketAuthorization(admin, msg, keys, date, true)
          out.errors.push(...auth.errors)
          const made = await createDraftJobForTicket(admin, msg, id, keys, subject, msg.internalDate, auth)
          if (made.job) { job = made.job; out.created.push(`${job.site_number} — "${subject}" · ${auth.wo ? `${auth.wo} (${auth.source})` : 'needs WO#'}`) }
          else out.unmatched.push(`${subject} (${made.reason})`)
        }
      } else if (!job) out.unmatched.push(`${subject} (no site number in the subject)`)
      else if (!job.work_order_number?.trim()) {
        // Pair a job that has no WO# yet with the one its work was authorized under — never overwrite one. The
        // Master Schedule and verified econstruction forwards stand on their own; the ticket's own WO# needs a
        // verified staff sender.
        const verified = !(await staffSenderProblem(admin, msg))
        const auth = await ticketAuthorization(admin, msg, keys.length ? keys : (job.site_number ? [job.site_number] : []), date, verified)
        out.errors.push(...auth.errors)
        if (auth.wo) {
          const { data: set } = await admin.from('con_jobs').update({ work_order_number: auth.wo }).eq('id', job.id)
            .or('work_order_number.is.null,work_order_number.eq.').select('id')
          if (set?.length) { job = { ...job, work_order_number: auth.wo }; out.paired.push(`${job.site_number} → ${auth.wo} (${auth.source})`) }
        } else out.needs_wo.push(`${job.site_number}: ${needsWoNote(auth)}`)
      }
      if (job && !jobs.has(job.id)) jobs.set(job.id, job)
    } catch (e) { out.errors.push(`${id}: ${(e as Error).message}`) }
  }
  for (const job of jobs.values()) {
    if (over(opts.budget)) { out.budget_hit = true; break }
    try {
      const r = await backfillFieldTicketsForJob(job.id, { apply: true })
      out.jobs++
      out.filed += r.results.filter(x => x.status === 'filed').length
      for (const x of r.results) if (x.status === 'error') out.errors.push(`${job.site_number}: ${x.detail}`)
    } catch (e) { out.errors.push(`${job.site_number}: ${(e as Error).message}`) }
  }
  return out
}

const STAR_RECEIVED = /\breceived\b[\s\S]{0,60}\b(irts|rti)\b/i

/** 3. Peggy's invoice workups → the job's Documents (Invoices) and its stage. */
export async function syncInvoiceDocs(opts: { sinceDays?: number; budget?: Budget } = {}): Promise<FeedResult['invoices']> {
  const out: FeedResult['invoices'] = { filed: 0, completed: 0, unmatched: [], errors: [] }
  const admin = createAdminClient()
  const since = new Date(Date.now() - (opts.sinceDays ?? 45) * 86_400_000).toISOString()
  const { data: docs } = await admin.from('billing_inbox_documents')
    .select('id, company_id, subject, received_at, primary_path, attachments, thread_replies, sender_email')
    .eq('inbox', 'econstruction').ilike('subject', '%invoice%').ilike('sender_email', 'pwilmoth%').gte('received_at', since).order('received_at')
  for (const d of docs ?? []) {
    if (over(opts.budget)) { out.budget_hit = true; break }
    try {
      const keys = siteKeysFromSubject(d.subject ?? '')
      const job = await findJobForKeys(admin, keys, true)
      if (!job) { out.unmatched.push(d.subject ?? d.id); continue }
      const replies = (d.thread_replies ?? []) as ThreadReply[]
      const starReceived = replies.some(r => STAR_RECEIVED.test(r.text))
      const atts = (d.attachments ?? []) as { name: string; mime: string; path: string }[]
      let newHere = 0
      for (const a of atts) {
        const { data: have } = await admin.from('con_documents').select('id').eq('job_id', job.id).eq('source_path', a.path).maybeSingle()
        if (have) continue
        const { data: blob, error: dlErr } = await admin.storage.from(INBOX_BUCKET).download(a.path)
        if (dlErr || !blob) { out.errors.push(`${d.subject}: download ${a.name}: ${dlErr?.message ?? 'empty'}`); continue }
        const bytes = Buffer.from(await blob.arrayBuffer())
        const path = `${job.company_id}/${job.id}/invoices/${(d.received_at as string).slice(0, 10)}-${safeName(a.name)}`
        const { error: upErr } = await admin.storage.from(DOCS_BUCKET).upload(path, bytes, { contentType: a.mime, upsert: true })
        if (upErr) { out.errors.push(`${d.subject}: upload ${a.name}: ${upErr.message}`); continue }
        await admin.from('con_documents').insert({
          company_id: job.company_id, job_id: job.id, file_name: a.name, original_filename: a.name, storage_path: path, source_path: a.path,
          category: 'invoices', doc_type: 'invoice', review_status: starReceived ? 'filed' : 'needs_review', imported_by: 'gmail_invoice_feed', imported_at: new Date().toISOString(),
        })
        newHere++
      }
      if (newHere) out.filed += newHere
      // Stage: Peggy's workup = Need Invoiced; Star's "Received … IRTS" = sent to the customer = Complete.
      // Only a job whose work was under way moves. A site can carry a service-call invoice while its open job is still
      // a survey, a quote or waiting to be scheduled (32284 entry boots, 40041 probe daisy chain on 10/1/26) — those keep
      // the document but not the stage change.
      const want = starReceived ? 'complete' : 'invoicing'
      const underWay = ['in_progress', 'return_needed', 'on_hold', 'close_out', 'invoicing'].includes(job.stage)
      const canMove = underWay && job.stage !== 'complete' && (want === 'complete' || job.stage !== 'invoicing')
      if (canMove && (newHere || want === 'complete')) {
        const tag = want === 'complete' ? `Invoiced ${(d.received_at as string).slice(0, 10)} · sent to customer (Star)` : `Invoice workup ${(d.received_at as string).slice(0, 10)} (Peggy) · awaiting Starsky`
        const detail = (job.status_detail ?? '').includes('Invoice') ? job.status_detail : [job.status_detail, tag].filter(Boolean).join('  ->  ')
        const { error } = await admin.from('con_jobs').update({ stage: want, status_detail: detail, updated_at: new Date().toISOString() }).eq('id', job.id)
        if (error) out.errors.push(`${d.subject}: stage: ${error.message}`)
        else if (want === 'complete') out.completed++
        job.stage = want
      }
    } catch (e) { out.errors.push(`${d.subject}: ${(e as Error).message}`) }
  }
  return out
}

const VENDOR_BY_DOMAIN: [RegExp, string][] = [[/icontainment\.com$/i, 'ICON'], [/sourcena\.com$/i, 'Source'], [/spatco\.com$/i, 'Spatco'], [/morgan-brothers\.net$/i, 'Morgan Brothers'], [/chaneyenterprises\.com$/i, 'Chaney']]
const ORDER_SUBJECT = /material order|order request|placing this order|\border\b/i
const PO_REPLY = /\bP\.?O\.?\s*#?\s*:?\s*(\d{4,7})\b/i
const SHANNON = /^sparsons\.rp@gmail\.com$/i

/**
 * 4. Reconcile the plate with the order mail Trae sends. He copies econstruction on every order, so his sent order
 *    shows up there. Trae's rule (10/1/26): no vendor ships without a PO# from Shannon. So a sent order waits on
 *    Shannon for the PO# first; her "PO # 24241" reply in the thread records the PO and moves the wait to the vendor;
 *    the vendor's reply brings the row back to Trae with the words on it.
 */
export async function syncOrderMail(opts: { sinceDays?: number; budget?: Budget } = {}): Promise<FeedResult['orders']> {
  const out: FeedResult['orders'] = { sent: 0, po: 0, replied: 0, errors: [] }
  if (!connectedInboxes().includes('econstruction')) return out
  const admin = createAdminClient()
  let ids: string[]
  try { ids = await listMessages('econstruction', `newer_than:${opts.sinceDays ?? 7}d from:tdodson.rp@proton.me (order OR "take-off")`, 30) } catch (e) { out.errors.push(`list: ${(e as Error).message}`); return out }
  const { data: tasks } = await admin.from('con_tasks').select('id, site_number, status, action, detail, waiting_on').eq('kind', 'order').in('status', ['open', 'waiting'])
  const open = (tasks ?? []) as { id: string; site_number: string | null; status: string; action: Record<string, unknown> | null; detail: string | null; waiting_on: string | null }[]
  for (const id of ids) {
    if (over(opts.budget)) { out.budget_hit = true; break }
    try {
      const msg = await getMessage('econstruction', id)
      const subject = header(msg, 'Subject')
      if (!ORDER_SUBJECT.test(subject)) continue
      const keys = siteKeysFromSubject(subject)
      const task = open.find(t => t.site_number && keys.some(k => k.toUpperCase() === t.site_number!.toUpperCase() || t.site_number!.toUpperCase().endsWith(k.toUpperCase())))
      if (!task) continue
      const a = (task.action ?? {}) as Record<string, unknown>
      const to = parseAddress(header(msg, 'To'))
      const vendor = VENDOR_BY_DOMAIN.find(([re]) => re.test(to.email))?.[1] ?? (to.email.split('@')[1] ?? 'vendor')
      if (a.order_message_id !== id) {
        const sentDay = ymdET(msg.internalDate)
        const patch = { status: 'waiting', waiting_on: 'Shannon (PO#)', waiting_since: sentDay, action: { ...a, type: a.type ?? 'order_email', draft_status: 'sent', sent_at: new Date(Number(msg.internalDate)).toISOString(), order_message_id: id, order_subject: subject, vendor_name: vendor }, detail: [task.detail, `Sent ${sentDay} to ${to.email}: "${subject}" (from the econstruction copy). Waiting on Shannon's PO# — no vendor ships without one.`].filter(Boolean).join('\n'), updated_at: new Date().toISOString() }
        await admin.from('con_tasks').update(patch).eq('id', task.id)
        Object.assign(task, { status: 'waiting', waiting_on: patch.waiting_on, action: patch.action, detail: patch.detail })
        out.sent++
      }
      // Thread: Shannon's PO#, then the vendor's answer.
      const cur = (task.action ?? {}) as Record<string, unknown>
      const thread = await getThread('econstruction', msg.threadId)
      const later = thread.messages.filter(m => m.id !== id && Number(m.internalDate) > Number(msg.internalDate)).map(m => ({ m, from: parseAddress(header(m, 'From')), text: stripQuoted(extractText(m)) }))
      const po = later.find(x => SHANNON.test(x.from.email) && PO_REPLY.test(x.text))
      if (po && !cur.po_number) {
        const num = (po.text.match(PO_REPLY) as RegExpMatchArray)[1]
        const day = ymdET(po.m.internalDate)
        const patch = { waiting_on: vendor, waiting_since: day, action: { ...cur, po_number: num, po_message_id: po.m.id, po_at: new Date(Number(po.m.internalDate)).toISOString() }, detail: [task.detail, `PO# ${num} from Shannon ${day}. Now waiting on ${vendor}.`].filter(Boolean).join('\n'), updated_at: new Date().toISOString() }
        await admin.from('con_tasks').update(patch).eq('id', task.id)
        Object.assign(task, { waiting_on: vendor, action: patch.action, detail: patch.detail })
        out.po++
      }
      const reply = later.find(x => !RPS_TECH.test(x.from.email) && !/proton\.me$/i.test(x.from.email) && !SHANNON.test(x.from.email))
      const cur2 = (task.action ?? {}) as Record<string, unknown>
      if (reply && task.status === 'waiting' && cur2.replied_message_id !== reply.m.id) {
        const noPo = cur2.po_number ? '' : ' (still no PO# from Shannon — they cannot ship)'
        await admin.from('con_tasks').update({ status: 'open', priority: 1, waiting_on: null, waiting_since: null, detail: [task.detail, `Reply from ${reply.from.name || reply.from.email} ${ymdET(reply.m.internalDate)}${noPo}: ${reply.text.slice(0, 500)}`].filter(Boolean).join('\n'), action: { ...cur2, replied_message_id: reply.m.id, replied_at: new Date(Number(reply.m.internalDate)).toISOString() }, updated_at: new Date().toISOString() }).eq('id', task.id)
        task.status = 'open'
        out.replied++
      }
    } catch (e) { out.errors.push(`${id}: ${(e as Error).message}`) }
  }
  return out
}

/** Two route passes so each stays inside the 60 s function budget: 'updates' = tech updates + field tickets, 'orders' = invoice workups + order mail. */
export async function syncJobEmailFeed(opts: { sinceDays?: number; part?: 'updates' | 'orders' | 'all' } = {}): Promise<Partial<FeedResult>> {
  const budget: Budget = { deadline: Date.now() + PASS_BUDGET_MS }
  const part = opts.part ?? 'all'
  const out: Partial<FeedResult> = {}
  if (part !== 'orders') { out.updates = await syncTechUpdates({ ...opts, budget }); out.tickets = await syncFieldTickets({ ...opts, budget }) }
  if (part !== 'updates') { out.invoices = await syncInvoiceDocs({ sinceDays: Math.max(opts.sinceDays ?? 3, 14), budget }); out.orders = await syncOrderMail({ sinceDays: 7, budget }) }
  return out
}
