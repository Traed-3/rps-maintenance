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
        .select('received_at, sender, subject, body_preview, status, converted_ticket_id, detected_asset')
        .eq('company_id', COMPANY_ID)
        .gte('received_at', periodStart.toISOString())
        .lte('received_at', periodEnd.toISOString())
        .order('received_at'),
      admin.from('repair_tickets')
        .select('ticket_number, title, status, priority, created_at, asset_id, source')
        .eq('company_id', COMPANY_ID)
        .gte('created_at', periodStart.toISOString())
        .lte('created_at', periodEnd.toISOString())
        .order('created_at'),
      admin.from('repair_tickets')
        .select('ticket_number, title, date_completed, completion_notes, asset_id, completed_by')
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

    // Look up asset unit numbers + profile names so the model has labels, not UUIDs
    const assetIds   = uniq([...(newTicketsRes.data ?? []), ...(completedRes.data ?? [])].map((t: any) => t.asset_id).filter(Boolean))
    const profileIds = uniq((completedRes.data ?? []).map((t: any) => t.completed_by).filter(Boolean))
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

    const context = {
      period: { start: fmtET(periodStart), end: fmtET(periodEnd) },
      emails: (emailsRes.data ?? []).map((e: any) => ({
        time:    fmtET(e.received_at, true),
        sender:  e.sender,
        subject: e.subject,
        body:    (e.body_preview ?? '').slice(0, 400),
        status:  e.status,
        asset:   e.detected_asset,
      })),
      tickets_created: (newTicketsRes.data ?? []).map((t: any) => ({
        ticket: t.ticket_number,
        asset:  assetById.get(t.asset_id) ?? null,
        title:  t.title,
        status: t.status,
        priority: t.priority,
        source: t.source,
      })),
      tickets_completed: (completedRes.data ?? []).map((t: any) => ({
        ticket:           t.ticket_number,
        asset:            assetById.get(t.asset_id) ?? null,
        title:            t.title,
        date_completed:   t.date_completed,
        completion_notes: (t.completion_notes ?? '').slice(0, 400),
        completed_by:     profileById.get(t.completed_by) ?? null,
      })),
      review_queue: (reviewRes.data ?? []).map((g: any) => ({
        time: fmtET(g.received_at, true), sender: g.sender, subject: g.subject,
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
  return `You are the daily-update writer for RPS Maintenance's shop dashboard. Trae (the owner) reads this at 3pm every day to know what changed.

WRITE IN TRAE'S PREFERRED FORMAT:
- Markdown sections grouped by TECH INITIALS (from the email senders + completed_by names).
- **Combine AR (Austin Renner) and RY (Ritchie Yatsko) into one section labeled "AR / RY".** They work as a pair.
- Within each tech's section, list the assets they touched. One short bullet per asset describing what changed (what they reported, fixed, ordered, or assigned).
- If nothing changed in the window, say so in one sentence. Do not invent activity.
- No timestamps in the body — Trae doesn't want them.
- Keep it tight. No flowery prose, no preamble, no closing. Just the sections.
- After the tech sections, add a short "**Still needs attention**" section listing anything in the review queue or any unassigned new tickets.

INITIALS MAP (derive from email username; first + last initial):
- ryatsko.rp → RY (Ritchie Yatsko)
- arenner.rp → AR (Austin Renner)
- akerner.rp → AK (Ariel Kerner)
- wlongo.rp → WL (William Longo)
- fdodson.rp → FD (Fred Dodson)
- For anyone else, derive initials from their email username.
- Anything from "maintenance.rps@gmail.com" is the shared inbox — usually a one-word "Fred" reply means Fred assigned the ticket.

PERIOD: ${ctx.period.start} → ${ctx.period.end}

DATA (JSON):
${JSON.stringify(ctx, null, 2)}

Now write the summary.`
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
