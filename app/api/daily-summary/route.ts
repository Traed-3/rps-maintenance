import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendAlertEmail } from '@/lib/email'

const COMPANY_ID    = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const RECIPIENT     = 'finance.trae@proton.me'
const TZ            = 'America/New_York'

export const maxDuration = 60

/**
 * GET /api/daily-summary
 *
 * Fires at 3pm ET daily (via GitHub Action). Pulls everything that has
 * changed in the shop since the last summary, asks Claude to write a
 * by-initial recap, stores it, and emails Trae.
 *
 * Query params:
 *  - secret       — CRON_SECRET (required)
 *  - dry_run=true — generate + return content, skip save + email (used by Ask RPS)
 */
export async function GET(request: NextRequest) {
  const authHeader  = request.headers.get('authorization')
  const querySecret = request.nextUrl.searchParams.get('secret')
  const cronSecret  = process.env.CRON_SECRET
  const dryRun      = request.nextUrl.searchParams.get('dry_run') === 'true'

  // Cron path: must present the secret. In-app path (dry_run): a logged-in
  // user is enough — no secret needed since the result isn't persisted or emailed.
  const hasSecret = authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret
  if (!hasSecret) {
    if (!dryRun) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin  = createAdminClient()

  try {
    // ── 1) Period: from last summary's period_end to now (fallback 24h) ────
    const { data: last } = await admin
      .from('daily_summaries')
      .select('period_end')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const periodEnd   = new Date()
    const periodStart = last?.period_end
      ? new Date(last.period_end)
      : new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000)

    // ── 2) Pull changes in the window ──────────────────────────────────────
    const [emailsRes, newTicketsRes, completedRes, reviewRes] = await Promise.all([
      admin.from('gmail_imports')
        .select('received_at, sender, subject, body_preview, converted_ticket_id, detected_asset')
        .eq('company_id', COMPANY_ID)
        .gte('received_at', periodStart.toISOString())
        .lte('received_at', periodEnd.toISOString())
        .in('status', ['converted','duplicate'])
        .order('received_at'),
      admin.from('repair_tickets')
        .select('id, ticket_number, title, status, priority, created_at, asset_id, source')
        .eq('company_id', COMPANY_ID)
        .gte('created_at', periodStart.toISOString())
        .lte('created_at', periodEnd.toISOString())
        .order('created_at'),
      admin.from('repair_tickets')
        .select('id, ticket_number, title, date_completed, completion_notes, asset_id, completed_by')
        .eq('company_id', COMPANY_ID)
        .eq('status', 'completed')
        .gte('date_completed', periodStart.toISOString().split('T')[0])
        .lte('date_completed', periodEnd.toISOString().split('T')[0])
        .order('date_completed'),
      admin.from('gmail_imports')
        .select('received_at, sender, subject')
        .eq('company_id', COMPANY_ID)
        .eq('status', 'pending')
        .order('received_at'),
    ])

    // Pull CURRENT status of every ticket touched by an email — the model has to
    // see the real status field, not infer it from email body context.
    const touchedTicketIds = uniq((emailsRes.data ?? []).map((e: any) => e.converted_ticket_id).filter(Boolean))
    const { data: touchedTickets } = touchedTicketIds.length
      ? await admin.from('repair_tickets')
          .select('id, ticket_number, status, asset_id, title, assigned_to')
          .in('id', touchedTicketIds)
      : { data: [] as any[] }

    // Asset + profile label lookups
    const assetIds = uniq([
      ...(newTicketsRes.data   ?? []).map((t: any) => t.asset_id),
      ...(completedRes.data    ?? []).map((t: any) => t.asset_id),
      ...((touchedTickets      ?? []) as any[]).map((t: any) => t.asset_id),
    ].filter(Boolean))
    const profileIds = uniq([
      ...(completedRes.data ?? []).map((t: any) => t.completed_by),
      ...((touchedTickets   ?? []) as any[]).map((t: any) => t.assigned_to),
    ].filter(Boolean))
    const [assetsRes, profilesRes] = await Promise.all([
      assetIds.length
        ? admin.from('assets').select('id, unit_number').in('id', assetIds)
        : { data: [] as any[] },
      profileIds.length
        ? admin.from('profiles').select('id, full_name').in('id', profileIds)
        : { data: [] as any[] },
    ])
    const assetById   = new Map((assetsRes.data   ?? []).map((a: any) => [a.id, a.unit_number]))
    const profileById = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]))
    const ticketById  = new Map(((touchedTickets ?? []) as any[]).map((t: any) => [t.id, t]))

    // Group every email event under the sender's initials, with the resolved
    // ticket + ITS CURRENT STATUS attached. This is the source of truth handed
    // to the model — no further data joins or inferences allowed.
    type Event = {
      asset: string | null
      ticket_number: string | null
      ticket_current_status: string | null
      ticket_assigned_to: string | null
      email_subject: string
      email_body: string
    }
    const byInitials: Record<string, { full_name: string; events: Event[] }> = {}
    for (const e of (emailsRes.data ?? []) as any[]) {
      const { initials, full_name } = whoIs(e.sender)
      const tk = e.converted_ticket_id ? ticketById.get(e.converted_ticket_id) : null
      const ev: Event = {
        asset: tk ? (assetById.get(tk.asset_id) ?? null) : e.detected_asset,
        ticket_number: tk?.ticket_number ?? null,
        ticket_current_status: tk?.status ?? null,
        ticket_assigned_to: tk?.assigned_to ? (profileById.get(tk.assigned_to) ?? null) : null,
        email_subject: e.subject ?? '',
        email_body: (e.body_preview ?? '').slice(0, 500),
      }
      ;(byInitials[initials] ||= { full_name, events: [] }).events.push(ev)
    }

    const tickets_completed_in_window = ((completedRes.data ?? []) as any[]).map((t: any) => ({
      ticket_number:    t.ticket_number,
      asset:            assetById.get(t.asset_id) ?? null,
      title:            t.title,
      date_completed:   t.date_completed,
      completion_notes: (t.completion_notes ?? '').slice(0, 400),
      completed_by:     profileById.get(t.completed_by) ?? null,
    }))

    const unassigned_new_tickets = ((newTicketsRes.data ?? []) as any[])
      .filter((t: any) => t.status !== 'completed' && t.status !== 'closed' && t.status !== 'deferred')
      .map((t: any) => ({
        ticket_number: t.ticket_number,
        asset:         assetById.get(t.asset_id) ?? null,
        title:         t.title,
        status:        t.status,
        priority:      t.priority,
      }))

    const context = {
      period: { start: fmtET(periodStart), end: fmtET(periodEnd) },
      by_initials: byInitials,
      tickets_completed_in_window,
      unassigned_new_tickets,
      review_queue: (reviewRes.data ?? []).map((g: any) => ({
        sender: g.sender, subject: g.subject,
      })),
    }

    // ── 3) Build the summary deterministically from the data ──────────────
    // No LLM — the prompt-based approach kept inferring "complete" from email
    // body wording even when ticket_current_status said otherwise. Template
    // is uglier prose but 100% accurate to the database.
    const content = renderSummary(context)
    if (!content) {
      return NextResponse.json({ ok: false, error: 'Empty summary' }, { status: 500 })
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, dry_run: true, period: context.period, content })
    }

    // ── 4) Save + email ────────────────────────────────────────────────────
    const { data: saved, error: saveErr } = await admin
      .from('daily_summaries')
      .insert({
        company_id:    COMPANY_ID,
        period_start:  periodStart.toISOString(),
        period_end:    periodEnd.toISOString(),
        content,
        email_sent_to: RECIPIENT,
        created_via:   'cron',
      })
      .select('id')
      .single()
    if (saveErr) return NextResponse.json({ ok: false, error: saveErr.message }, { status: 500 })

    await sendAlertEmail({
      to:      RECIPIENT,
      subject: `Daily shop summary — ${context.period.end}`,
      title:   `Shop update: ${context.period.start} → ${context.period.end}`,
      message: mdToInlineHtml(content),
      link:    '/dashboard',
    })

    return NextResponse.json({ ok: true, summary_id: saved?.id, period: context.period })
  } catch (e: any) {
    console.error('[Daily Summary Error]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function uniq<T>(arr: T[]): T[] { return [...new Set(arr)] }

function fmtET(input: string | Date, withTime = false): string {
  const d = typeof input === 'string' ? new Date(input) : input
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  return new Intl.DateTimeFormat('en-US', opts).format(d)
}

// Combine AR + RY into one group. Everyone else keeps their own initials.
function bucketInitials(initials: string): string {
  return initials === 'AR' || initials === 'RY' ? 'AR / RY' : initials
}

// Pretty status label for the inline tag next to each asset.
function statusLabel(s: string | null): string {
  if (!s) return ''
  const m: Record<string, string> = {
    open: 'open', new: 'new', assigned: 'assigned', in_progress: 'in progress',
    waiting_parts: 'waiting on parts', completed: 'completed', closed: 'completed',
    deferred: 'deferred',
  }
  return m[s] ?? s
}

// Pull the first signal-bearing line from an email body. Skips iPhone signature
// junk, forwarded-message blocks, and tiny one-word replies that don't add info.
function cleanSnippet(body: string, subject: string): string {
  // Drop everything from the first "Begin forwarded message" / "From:" header
  // onward — those are quoted history, not new content. (No leading-newline
  // requirement, so we catch bodies that START with the forwarded header.)
  const trimmed = (body ?? '')
    .split(/(?:^|\n)\s*(?:begin forwarded message|from:|on .+ wrote:)/i)[0]
  const lines = trimmed.split(/\n+/).map(l => l.trim()).filter(Boolean)
  const skip = /^(sent from my|begin forwarded|>|--+$|thanks,?$|respectfully|regards|^[A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z][a-z]+$)/i
  const trivial = /^(complete|completed|done|finished|fred|ok|yes|no)\.?$/i
  for (const l of lines) {
    if (l.length < 3) continue
    if (skip.test(l)) continue
    if (trivial.test(l)) continue   // one-word replies are noise; status badge covers them
    return l.replace(/^Update\s+/i, '').replace(/\s+/g, ' ').slice(0, 200)
  }
  // Fall back to subject if body is empty / all junk
  return (subject ?? '').replace(/^(RE:|FWD:|Fwd:|Re:)\s*/i, '').trim().slice(0, 200)
}

// Build markdown summary directly from the structured context. No LLM.
function renderSummary(ctx: any): string {
  const out: string[] = []

  // ── 1) Group events by bucketed initials → asset → ticket ────────────────
  // Grouping by (asset, ticket) prevents the "one asset has 3 tickets in 3
  // different statuses → which status do we show?" problem.
  type Event = {
    asset: string | null
    ticket_number: string | null
    ticket_current_status: string | null
    email_subject: string
    email_body: string
  }
  type TicketGroup = { status: string | null; lines: string[] }
  const buckets: Record<string, Record<string, Record<string, TicketGroup>>> = {}

  for (const [initials, info] of Object.entries(ctx.by_initials) as [string, any][]) {
    const bucket = bucketInitials(initials)
    for (const ev of info.events as Event[]) {
      const assetKey  = ev.asset ?? '(unknown asset)'
      const ticketKey = ev.ticket_number ?? '__no_ticket__'
      const assets    = (buckets[bucket]    ||= {})
      const tickets   = (assets[assetKey]   ||= {})
      const grp       = (tickets[ticketKey] ||= { status: ev.ticket_current_status, lines: [] })
      grp.status = ev.ticket_current_status  // last write wins (events are in chrono order)
      const snip = cleanSnippet(ev.email_body, ev.email_subject)
      if (snip && !grp.lines.includes(snip)) grp.lines.push(snip)
    }
  }

  // Order: AR / RY first, then other initials alphabetically
  const bucketOrder = Object.keys(buckets).sort((a, b) =>
    a === 'AR / RY' ? -1 : b === 'AR / RY' ? 1 : a.localeCompare(b)
  )

  if (bucketOrder.length === 0 && (ctx.tickets_completed_in_window ?? []).length === 0) {
    return 'No changes since the last update.'
  }

  for (const bucket of bucketOrder) {
    out.push(`## ${bucket}`, '')
    const assets = buckets[bucket]
    for (const asset of Object.keys(assets).sort()) {
      const tickets = assets[asset]
      const ticketKeys = Object.keys(tickets)

      if (ticketKeys.length === 1) {
        // Single ticket on this asset → status next to the asset header
        const grp = tickets[ticketKeys[0]]
        const statusTag = grp.status ? ` _(${statusLabel(grp.status)})_` : ''
        out.push(`**${asset}**${statusTag}`)
        for (const ln of grp.lines) out.push(`- ${ln}`)
        out.push('')
      } else {
        // Multiple tickets on this asset → status per ticket line
        out.push(`**${asset}**`)
        for (const tk of ticketKeys) {
          const grp = tickets[tk]
          const statusTag = grp.status ? ` _(${statusLabel(grp.status)})_` : ''
          const summary = grp.lines.length ? grp.lines.join('; ') : '(activity)'
          out.push(`- ${summary}${statusTag}`)
        }
        out.push('')
      }
    }
  }

  // ── 2) Completed today (from DB, not inferred) ───────────────────────────
  const completed = ctx.tickets_completed_in_window ?? []
  if (completed.length) {
    out.push('## Completed today', '')
    // Group by asset (one asset can have multiple completions)
    const byAsset: Record<string, any[]> = {}
    for (const t of completed) {
      const key = t.asset ?? '(unknown asset)'
      ;(byAsset[key] ||= []).push(t)
    }
    for (const asset of Object.keys(byAsset).sort()) {
      out.push(`**${asset}**`)
      for (const t of byAsset[asset]) {
        const who   = t.completed_by ? ` — ${t.completed_by}` : ''
        const noteClean = cleanSnippet(t.completion_notes ?? '', '')
        const note  = noteClean ? ` — ${noteClean}` : ''
        const title = (t.title ?? '').replace(/\s+/g, ' ').slice(0, 100)
        out.push(`- ${title}${who}${note}`)
      }
      out.push('')
    }
  }

  // ── 3) Still needs attention ─────────────────────────────────────────────
  const review     = ctx.review_queue ?? []
  const unassigned = ctx.unassigned_new_tickets ?? []
  if (review.length || unassigned.length) {
    out.push('## Still needs attention', '')
    for (const r of review) {
      const subj = (r.subject ?? '').replace(/\s+/g, ' ').slice(0, 120)
      out.push(`- Review queue (${r.sender}): ${subj}`)
    }
    for (const t of unassigned) {
      const asset = t.asset ?? '(no asset)'
      const title = (t.title ?? '').replace(/\s+/g, ' ').slice(0, 100)
      out.push(`- **${asset}** unassigned (${statusLabel(t.status)}): ${title}`)
    }
  }

  return out.join('\n').trim()
}

// Map a sender email like "ryatsko.rp@gmail.com" → { initials: "RY", full_name: "Ritchie Yatsko" }
// Initials are the first letter of the first name + first letter of the surname
// the user actually goes by — for the small RPS crew we hardcode known names;
// anything unknown falls back to first-two-letters of the username.
function whoIs(email: string): { initials: string; full_name: string } {
  const e = (email ?? '').toLowerCase()
  const map: Record<string, { initials: string; full_name: string }> = {
    'ryatsko.rp@gmail.com':       { initials: 'RY', full_name: 'Ritchie Yatsko' },
    'arenner.rp@gmail.com':       { initials: 'AR', full_name: 'Austin Renner' },
    'akerner.rp@gmail.com':       { initials: 'AK', full_name: 'Ariel Kerner' },
    'wlongo.rp@gmail.com':        { initials: 'WL', full_name: 'William Longo' },
    'fdodson.rp@gmail.com':       { initials: 'FD', full_name: 'Fred Dodson' },
    'sdodson.rp@gmail.com':       { initials: 'SD', full_name: 'Shannon Dodson' },
    'maintenance.rps@gmail.com':  { initials: 'FD', full_name: 'Fred Dodson' }, // shared inbox; usually Fred
  }
  if (map[e]) return map[e]
  // Fallback: take the user part before the @, drop ".rp" suffix if present, then 2 initials
  const user = e.split('@')[0].replace(/\.rp$/, '')
  const initials = (user.slice(0, 2)).toUpperCase()
  return { initials, full_name: user }
}

// Minimal markdown → inline HTML for the email body (Resend accepts HTML)
function mdToInlineHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4 style="margin:18px 0 6px;font-size:14px">$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3 style="margin:22px 0 8px;font-size:16px">$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2 style="margin:24px 0 10px;font-size:18px">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0">$1</li>')
  html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>\s*)+/g, m => `<ul style="margin:6px 0 12px;padding-left:20px">${m}</ul>`)
  return html.split(/\n\n+/).map(p => p.startsWith('<') ? p : `<p style="margin:8px 0;line-height:1.6">${p}</p>`).join('')
}
