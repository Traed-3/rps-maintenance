import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendAlertEmail } from '@/lib/email'

const COMPANY_ID    = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const RECIPIENT     = 'finance.trae@proton.me'
const MODEL         = 'claude-sonnet-4-6'
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

    // ── 3) Ask Claude to write the summary in Trae's preferred format ──────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const prompt = buildPrompt(context)
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })
    const content = msg.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim()

    if (!content) {
      return NextResponse.json({ ok: false, error: 'Empty model response' }, { status: 500 })
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

function buildPrompt(ctx: any): string {
  return `You are the daily-update writer for RPS Maintenance's shop dashboard. Trae (the owner) reads this at 3pm to see what changed.

THE DATA BELOW IS THE COMPLETE SOURCE OF TRUTH. You are writing prose from it. You are NOT analyzing or inferring beyond what is explicitly stated.

HARD RULES — these are non-negotiable:
1. NEVER invent ticket numbers. In fact, do NOT include any ticket numbers in the output. Trae doesn't want them.
2. NEVER call something "complete", "closed", "fixed", "resolved", or "done" unless the asset's CURRENT ticket status in the data is literally "completed" OR that exact ticket appears in tickets_completed_in_window.
3. NEVER infer a fix from email body wording alone. If the body says "installed brake harness" but ticket_current_status is "in_progress" or "open", describe it as ongoing work ("installed brake harness, still working") — not as complete.
4. If the data is empty, write a single sentence: "No changes since the last update." Do not pad.
5. Use ONLY the asset unit numbers, sender names, and statuses present in the data. Do not embellish.

FORMAT:
- Markdown sections grouped by tech initials. Each section header is "## INITIALS" (e.g. "## AR / RY").
- COMBINE AR (Austin Renner) + RY (Ritchie Yatsko) into a single "## AR / RY" section. They work as a pair.
- Within each section, group by ASSET. One bold asset header (e.g. "**A1**") followed by 1-3 short bullets describing what changed on that asset (what they reported, ordered, installed, assigned, etc.) — drawn from the email_subject + email_body and the ticket_current_status.
- No timestamps. No ticket numbers. No preamble. No closing.
- After the tech sections, add "## Still needs attention" — list:
  * Anything in review_queue (one bullet per item: sender + brief subject)
  * Any unassigned_new_tickets (one bullet per asset: brief title)
  * If both are empty, omit the section entirely.

PERIOD: ${ctx.period.start} → ${ctx.period.end}

DATA (JSON):
${JSON.stringify(ctx, null, 2)}

Write the summary now, following the hard rules.`
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
