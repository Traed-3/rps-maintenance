import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { buildPlate, buildSignals, businessDaysSince, dueDelta, KIND_CLASS, KIND_LABEL, type TaskRow, type TaskKind } from '@/lib/my-plate'
import { packingSlipSiteKey } from '@/lib/construction-dashboard'
import { addTask, completeTask, dropTask, reopenTask, setDue, setPriority, snoozeTask, waitTask, answerTask, resolvePriceLine, draftOrderEmail, markOrderSent } from './actions'
import { ORDER_VENDORS, mailtoHref, type OrderDraft, type OrderVendorKey } from '@/lib/order-email'
import { CopyButton } from '@/components/plate/copy-button'

export const dynamic = 'force-dynamic'

const fmt = (iso: string | null) => iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : ''

export default async function MyPlatePage() {
  const profile = await requireConstruction()
  const admin = createAdminClient()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const since120 = new Date(Date.now() - 120 * 86_400_000).toISOString()

  const [{ data: rows }, { data: needed }, { data: bids }, { data: stale }, { data: quoting }, { data: quoted }, { data: slips }] = await Promise.all([
    admin.from('con_tasks').select('*').eq('owner_id', profile.id).neq('status', 'dropped').or(`status.neq.done,done_at.gte.${today}T00:00:00`).order('created_at'),
    admin.from('con_quote_line_items').select('id, description, quote_id, con_quotes!inner(quote_number, site_number, status, company_id)').eq('price_flag', 'needed').eq('con_quotes.status', 'draft').eq('con_quotes.company_id', profile.company_id),
    admin.from('con_quotes').select('id, quote_number, site_number, bid_due').eq('company_id', profile.company_id).eq('status', 'draft').not('bid_due', 'is', null).lte('bid_due', new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)),
    admin.from('con_job_materials').select('description, ordered_date, created_at, job_id, con_jobs!inner(site_number, company_id)').eq('status', 'ordered').eq('con_jobs.company_id', profile.company_id).lt('created_at', new Date(Date.now() - 10 * 86_400_000).toISOString()),
    admin.from('con_jobs').select('id, site_number, work_order_number, status_detail').eq('company_id', profile.company_id).eq('stage', 'quoting').not('status_detail', 'ilike', '%waiting%').not('status_detail', 'ilike', '%sent to%'),
    admin.from('con_quotes').select('job_id').eq('company_id', profile.company_id).not('job_id', 'is', null),
    admin.from('billing_inbox_documents').select('subject, body_preview, status, note, thread_replies').eq('company_id', profile.company_id).eq('kind', 'packing_slip').eq('status', 'new').gte('received_at', since120),
  ])

  const tasks = (rows ?? []) as TaskRow[]
  const plate = buildPlate(tasks, today)
  const quotedJobs = new Set((quoted ?? []).map(q => q.job_id))
  const unmatchedSlips = (slips ?? []).filter(s => {
    const replies = ((s.thread_replies ?? []) as { text?: string }[]).map(x => x.text ?? '')
    const stock = /\bstock\b/i.test(`${s.subject ?? ''} ${s.body_preview ?? ''} ${s.note ?? ''} ${replies.join(' ')}`)
    return !s.note && !stock && !packingSlipSiteKey(s.subject ?? '', s.body_preview, replies)
  }).length
  const signals = buildSignals({
    neededLines: (needed ?? []).map(l => { const q = l.con_quotes as unknown as { quote_number: string; site_number: string | null }; return { quote_number: q.quote_number, quote_id: l.quote_id, line_id: l.id, site_number: q.site_number, description: l.description } }),
    bidsDue: (bids ?? []).map(b => ({ quote_number: b.quote_number, quote_id: b.id, site_number: b.site_number, bid_due: b.bid_due as string })),
    staleOrders: (stale ?? []).map(m => ({ site_number: (m.con_jobs as unknown as { site_number: string }).site_number, description: m.description ?? '', ordered_date: m.ordered_date, job_id: m.job_id })),
    quotingNoQuote: (quoting ?? []).filter(j => !quotedJobs.has(j.id) && /^\d{5}$|^(SU|IP)-/i.test(j.site_number ?? '')).slice(0, 12),
    unmatchedSlips,
    existingKeys: new Set(tasks.map(t => t.source_key).filter((k): k is string => !!k)),
  }, today)

  const openCount = plate.now.length + plate.next.length

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto overflow-x-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">My Plate</h1>
          <p className="text-sm text-gray-500 mt-0.5">{openCount} open · {plate.waiting.length} waiting on someone · {plate.doneToday.length} done today. Top row is the next thing to do.</p>
        </div>
        <span className="text-xs text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' })}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Section title="Do now" hint="Overdue, due today, hot, or due within 3 days" tone="bg-[#C00000] text-white" count={plate.now.length} empty="Nothing pressing. Work the Next list.">
            {plate.now.map(t => <TaskLine key={t.id} t={t} today={today} />)}
          </Section>
          <Section title="Next" hint="In order: soonest due, then priority, then oldest" tone="bg-[#FFC000] text-black" count={plate.next.length} empty="Empty. Add what is on your mind below.">
            {plate.next.map(t => <TaskLine key={t.id} t={t} today={today} />)}
          </Section>
          <Section title="Waiting on someone" hint="Longest wait first. Five business days is a nudge." tone="bg-[#5B9BD5] text-white" count={plate.waiting.length} empty="Nobody owes you anything right now.">
            {plate.waiting.map(t => <TaskLine key={t.id} t={t} today={today} waiting />)}
          </Section>
          {plate.snoozed.length > 0 && (
            <Section title="Snoozed" hint="Back on the list on the date shown" tone="bg-gray-200 text-gray-700" count={plate.snoozed.length} empty="">
              {plate.snoozed.map(t => <TaskLine key={t.id} t={t} today={today} />)}
            </Section>
          )}
          {plate.doneToday.length > 0 && (
            <Section title="Done today" hint="" tone="bg-[#70AD47] text-white" count={plate.doneToday.length} empty="">
              {plate.doneToday.map(t => (
                <li key={t.id} className="px-3 py-2 flex items-center gap-2 text-sm text-gray-500 line-through">
                  <span className="truncate min-w-0 flex-1">{t.site_number ? `${t.site_number} · ` : ''}{t.title}</span>
                  <form action={reopenTask.bind(null, t.id)}><button className="text-xs text-blue-600 hover:underline no-underline" style={{ textDecoration: 'none' }}>Reopen</button></form>
                </li>
              ))}
            </Section>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide bg-gray-900 text-white">Add to my plate</div>
            <form action={addTask} className="p-3 space-y-2 text-sm">
              <input name="title" required placeholder="What needs doing" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5" />
              <div className="grid grid-cols-2 gap-2">
                <input name="site_number" placeholder="Site (40013, SU-8605)" className="rounded-md border border-gray-300 px-2.5 py-1.5" />
                <input name="due_date" type="date" className="rounded-md border border-gray-300 px-2.5 py-1.5" />
                <select name="kind" defaultValue="followup" className="rounded-md border border-gray-300 px-2 py-1.5">
                  {(Object.keys(KIND_LABEL) as TaskKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <select name="priority" defaultValue="2" className="rounded-md border border-gray-300 px-2 py-1.5">
                  <option value="1">Hot</option><option value="2">Normal</option><option value="3">Low</option>
                </select>
              </div>
              <textarea name="detail" rows={2} placeholder="Detail, numbers, who to call" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5" />
              <button className="w-full rounded-md bg-blue-600 text-white py-1.5 text-sm font-medium hover:bg-blue-700">Add</button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide bg-[#7030A0] text-white flex items-center justify-between"><span>Signals from the data</span><span className="tabular-nums">{signals.length}</span></div>
            {signals.length === 0 ? <p className="p-3 text-xs text-gray-400">Nothing the data can see that is not already on the plate.</p> : (
              <ul className="divide-y divide-gray-100">
                {signals.map(s => (
                  <li key={s.key} className="px-3 py-2 text-xs flex items-start gap-2">
                    <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full border text-[10px] ${KIND_CLASS[s.kind]}`}>{KIND_LABEL[s.kind]}</span>
                    <span className="min-w-0 flex-1 text-gray-700">{s.href ? <Link href={s.href} className="hover:underline">{s.title}</Link> : s.title}</span>
                    <form action={addTask} className="shrink-0">
                      <input type="hidden" name="title" value={s.title} /><input type="hidden" name="kind" value={s.kind} /><input type="hidden" name="site_number" value={s.site_number ?? ''} /><input type="hidden" name="source_key" value={s.key} /><input type="hidden" name="detail" value={s.href ? `See ${s.href}` : ''} />{s.action && <input type="hidden" name="action" value={JSON.stringify(s.action)} />}
                      <button className="text-blue-600 hover:underline whitespace-nowrap">+ plate</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, hint, tone, count, empty, children }: { title: string; hint: string; tone: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className={`px-3 py-2 flex items-center justify-between ${tone}`}>
        <div className="text-xs font-semibold uppercase tracking-wide">{title}{hint && <span className="ml-2 font-normal normal-case tracking-normal opacity-80">{hint}</span>}</div>
        <span className="text-sm font-bold tabular-nums">{count}</span>
      </div>
      {count === 0 ? <p className="p-3 text-xs text-gray-400">{empty}</p> : <ul className="divide-y divide-gray-100">{children}</ul>}
    </div>
  )
}

function TaskLine({ t, today, waiting = false }: { t: TaskRow; today: string; waiting?: boolean }) {
  const d = dueDelta(t, today)
  const dueText = d === null ? '' : d > 0 ? `${d}d overdue` : d === 0 ? 'due today' : `due ${fmt(t.due_date)}`
  const dueClass = d === null ? 'text-gray-400' : d > 0 ? 'text-red-600 font-semibold' : d === 0 ? 'text-amber-700 font-semibold' : 'text-gray-500'
  const waitDays = waiting && t.waiting_since ? businessDaysSince(t.waiting_since, today) : 0
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full border text-[10px] ${KIND_CLASS[t.kind]}`}>{KIND_LABEL[t.kind]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-gray-900 leading-snug">{t.priority === 1 && <span className="text-red-600 mr-1" title="Hot">●</span>}{t.site_number && <span className="font-mono text-xs text-gray-500 mr-1.5">{t.site_number}</span>}{t.title}</div>
          {t.detail && <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">{t.detail}</div>}
          {!waiting && t.status === 'open' && <Resolver t={t} />}
          <div className="text-[11px] mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {waiting ? <span className={waitDays >= 5 ? 'text-red-600 font-semibold' : 'text-blue-700'}>waiting on {t.waiting_on}{t.waiting_since ? ` since ${fmt(t.waiting_since)} · ${waitDays} business day${waitDays === 1 ? '' : 's'}` : ''}{waitDays >= 5 ? ' · nudge' : ''}</span> : <span className={dueClass}>{dueText}</span>}
            {t.snoozed_until && t.snoozed_until > today && <span className="text-gray-400">snoozed to {fmt(t.snoozed_until)}</span>}
            {t.job_id && <Link href={`/construction/jobs/${t.job_id}`} className="text-blue-600 hover:underline">job</Link>}
            {t.quote_id && <Link href={`/billing/quotes/${t.quote_id}`} className="text-blue-600 hover:underline">quote</Link>}
            <span className="text-gray-300">{t.source}</span>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1 text-[11px]">
          <form action={completeTask.bind(null, t.id)}><button className="px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">Done</button></form>
          {waiting
            ? <form action={reopenTask.bind(null, t.id)}><button className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">Back to me</button></form>
            : <form action={waitTask.bind(null, t.id)} className="flex gap-1"><input name="who" placeholder="waiting on…" className="w-24 rounded border border-gray-300 px-1.5 py-0.5" /><button className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">Hand off</button></form>}
          <div className="flex gap-1">
            <form action={snoozeTask.bind(null, t.id)}><input type="hidden" name="days" value="1" /><button className="px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50" title="Snooze 1 day">+1d</button></form>
            <form action={snoozeTask.bind(null, t.id)}><input type="hidden" name="days" value="7" /><button className="px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50" title="Snooze a week">+1w</button></form>
            <form action={setPriority.bind(null, t.id)}><input type="hidden" name="priority" value={t.priority === 1 ? '2' : '1'} /><button className="px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50" title="Toggle hot">{t.priority === 1 ? 'cool' : 'hot'}</button></form>
            <form action={setDue.bind(null, t.id)} className="flex gap-0.5"><input name="due_date" type="date" defaultValue={t.due_date ?? ''} className="w-[7.5rem] rounded border border-gray-200 px-1 py-0.5 text-[10px]" /><button className="px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">set</button></form>
            <form action={dropTask.bind(null, t.id)}><button className="px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50" title="Drop it">✕</button></form>
          </div>
        </div>
      </div>
    </li>
  )
}


/** The control that handles the need from the row: price a quote line, draft the order mail, or just answer and close. */
function Resolver({ t }: { t: TaskRow }) {
  const a = (t.action ?? {}) as { type?: string; vendor?: OrderVendorKey; draft?: OrderDraft; draft_status?: string; site_name?: string; address?: string; work_order?: string; takeoff?: string; items?: string }
  const input = 'rounded border border-gray-300 px-1.5 py-0.5 text-[11px]'
  if (a.type === 'quote_line_price') {
    return (
      <form action={resolvePriceLine.bind(null, t.id)} className="mt-1.5 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[11px] space-y-1.5">
        <div className="font-semibold text-amber-900">Price it</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span>$</span><input name="unit_cost" required inputMode="decimal" placeholder="275" className={`${input} w-20`} />
          <span>per</span>
          <select name="unit" defaultValue="job" className={input}><option value="job">job</option><option value="day">day</option><option value="each">each</option><option value="hour">hour</option><option value="load">load</option></select>
          <input name="note" placeholder="where the number came from" className={`${input} w-44`} />
        </div>
        <label className="flex flex-wrap items-center gap-1.5"><input type="checkbox" name="add_to_catalog" defaultChecked /> save to RPS catalog as
          <input name="part_number" placeholder="WALK-BEHIND SAW" className={`${input} w-36`} />
          <select name="category" defaultValue="9" className={input}><option value="9">9 equipment</option><option value="10">10 disposables</option><option value="5">5 concrete / disposal</option><option value="11">11 sub</option><option value="12">12 permit</option></select>
        </label>
        <button className="px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700">Apply to quote</button>
      </form>
    )
  }
  if (a.type === 'order_email' || t.kind === 'order') {
    const d = a.draft
    return (
      <div className="mt-1.5 rounded-md border border-emerald-200 bg-emerald-50/60 p-2 text-[11px] space-y-1.5">
        {d ? (
          <>
            <div className="font-semibold text-emerald-900">Order email drafted{a.draft_status === 'sent' ? ' · sent' : ''}</div>
            <div className="text-gray-700"><b>To</b> {d.to} · <b>Cc</b> {d.cc.join(', ')}</div>
            <div className="text-gray-700"><b>Subject</b> {d.subject}</div>
            <pre className="whitespace-pre-wrap font-sans text-gray-700 bg-white rounded border border-emerald-100 p-2 max-h-48 overflow-auto">{d.body}</pre>
            <div className="flex flex-wrap items-center gap-1.5">
              <a href={mailtoHref(d)} className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">Open in mail</a>
              <CopyButton text={`To: ${d.to}\nCc: ${d.cc.join(', ')}\nSubject: ${d.subject}\n\n${d.body}`} label="Copy email" />
              <form action={markOrderSent.bind(null, t.id)} className="flex items-center gap-1"><input name="who" defaultValue="Shannon (PO#)" className={`${input} w-28`} /><button className="px-2 py-0.5 rounded border border-emerald-300 text-emerald-800 hover:bg-emerald-100">I sent it → waiting</button></form>
            </div>
            <details><summary className="cursor-pointer text-gray-500">Edit and redraft</summary><OrderForm t={t} a={a} input={input} /></details>
          </>
        ) : (
          <>
            <div className="font-semibold text-emerald-900">Draft the order email</div>
            <OrderForm t={t} a={a} input={input} />
          </>
        )}
      </div>
    )
  }
  return (
    <form action={answerTask.bind(null, t.id)} className="mt-1.5 flex items-center gap-1.5 text-[11px]">
      <input name="answer" placeholder="answer / what you did — closes the row" className={`${input} flex-1 min-w-0`} />
      <button className="px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap">Answer & close</button>
    </form>
  )
}

function OrderForm({ t, a, input }: { t: TaskRow; a: { vendor?: OrderVendorKey; site_name?: string; address?: string; work_order?: string; takeoff?: string; items?: string }; input: string }) {
  return (
    <form action={draftOrderEmail.bind(null, t.id)} className="mt-1 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <select name="vendor" defaultValue={a.vendor ?? 'icon'} className={input}>{(Object.keys(ORDER_VENDORS) as OrderVendorKey[]).map(k => <option key={k} value={k}>{ORDER_VENDORS[k].label}</option>)}</select>
        <input name="to" placeholder="to (blank = vendor default)" className={`${input} w-48`} />
        <input name="site" defaultValue={t.site_number ?? ''} placeholder="site" className={`${input} w-20`} />
        <input name="site_name" defaultValue={a.site_name ?? ''} placeholder="Global Exxon / Sunoco" className={`${input} w-32`} />
        <input name="address" defaultValue={a.address ?? ''} placeholder="address" className={`${input} w-56`} />
        <input name="work_order" defaultValue={a.work_order ?? ''} placeholder="WOT…" className={`${input} w-28`} />
        <input name="takeoff" defaultValue={a.takeoff ?? ''} placeholder="take-off / quote #" className={`${input} w-32`} />
      </div>
      <textarea name="items" rows={4} defaultValue={a.items ?? ''} placeholder={'(4) IRF 5B3.5x3.2AC - Icon SplitRepair Flange Fitting Kit … - $459.00 each\n(2) IAC FASTFUSE - … - $109.00 each'} className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px] font-mono" />
      <div className="flex flex-wrap items-center gap-1.5">
        <input name="note" placeholder="extra line (optional)" className={`${input} w-64`} />
        <label className="flex items-center gap-1"><input type="checkbox" name="ask_po" value="on" defaultChecked /> ask Shannon for a PO#</label>
        <button className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">Draft it</button>
      </div>
    </form>
  )
}
