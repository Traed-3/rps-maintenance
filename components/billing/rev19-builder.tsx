'use client'

import { useActionState, useMemo, useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PartPicker, type PickedPart } from '@/components/construction/part-picker'
import { money } from '@/lib/billing'
import { REV19_CATEGORIES, REV19_DEFAULTS, LABOR_RATES, TAX_PRESETS, PRICE_FLAG_LABEL, categoryMeta, computeRev19, defaultLineFor, type Rev19Inputs, type Rev19LineInput } from '@/lib/rev19'
import type { ActionState } from '@/app/(app)/billing/actions'

const inp = 'w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50'
const numInp = `${inp} text-right tabular-nums`
const lbl = 'block text-[11px] font-medium text-gray-600 mb-0.5 uppercase tracking-wide'

export type Rev19Row = {
  key: string; section: 'basic' | 'additional'; category: number
  description: string; part_number: string; part_id: string | null; subcategory: string
  quantity: string; unit_cost: string; sales_tax_pct: string; markup_pct: string; freight_per_unit: string; markup_applies: boolean
  men: string; hrs_each: string; labor_rate: string; travel_days: string; techs: string; day_label: string; crew: 'construction' | 'service'
  source_note: string; price_flag: string; is_stock: boolean; item_type: string
}
export type Rev19Header = {
  id?: string; kind: 'quote' | 'invoice'
  job_id?: string | null; customer_id?: string | null; quote_id?: string | null; service_ticket_id?: string | null
  department?: string | null; status?: string
  attn?: string | null; customer_email?: string | null; store_label?: string | null; site_number?: string | null
  facility_address?: string | null; city_state_zip?: string | null; project_description?: string | null
  csr_number?: string | null; po_number?: string | null; portal_wo_number?: string | null; work_order_number?: string | null
  proposal_date?: string | null; bid_due?: string | null; valid_until?: string | null; nte_amount?: number | null
  invoice_date?: string | null; due_date?: string | null
  project_manager?: string | null; construction_manager?: string | null; foreman?: string | null; compiled_by?: string | null; prepared_by?: string | null; signer_id?: string | null
  rate_card_id?: string | null
  material_markup_pct?: number | null; material_tax_pct?: number | null; sub_markup_pct?: number | null; labor_rate?: number | null
  contingency_pct?: number | null; contingency_flat?: number | null; profit_overhead_percent?: number | null; sales_tax_percent?: number | null
  scope_rows?: { scope: string; description: string }[] | null; exclusions?: string | null; warranty_line?: string | null; is_starting_quote?: boolean | null
}
type Customer = { id: string; name: string; brand?: string | null; rate_card_id?: string | null }
type Job = { id: string; site_number: string | null; work_order_number: string | null }
type RateCard = { id: string; name: string; labor_rate: number; sales_tax_pct: number | null }
type TeamMember = { id: string; full_name: string; job_title: string | null; role: string }

let _k = 0
export function newRow(section: 'basic' | 'additional', category: number, crew: 'construction' | 'service' = 'construction'): Rev19Row {
  const d = defaultLineFor(category, crew)
  return {
    key: `r${_k++}_${Date.now()}`, section, category, description: '', part_number: '', part_id: null, subcategory: '',
    quantity: d.quantity != null ? String(d.quantity) : '', unit_cost: d.unit_cost != null ? String(d.unit_cost) : '', sales_tax_pct: '', markup_pct: '', freight_per_unit: '', markup_applies: !!d.markup_applies,
    men: d.men != null ? String(d.men) : '', hrs_each: d.hrs_each != null ? String(d.hrs_each) : '', labor_rate: '', travel_days: d.travel_days != null ? String(d.travel_days) : '', techs: d.techs != null ? String(d.techs) : '',
    day_label: '', crew, source_note: '', price_flag: 'ok', is_stock: false, item_type: categoryMeta(category).kind === 'labor' ? 'labor' : categoryMeta(category).kind === 'trip' ? 'trip' : 'material',
  }
}
const N = (s: string) => (s === '' ? null : isFinite(Number(s)) ? Number(s) : null)
const toInput = (r: Rev19Row): Rev19LineInput => ({
  section: r.section, category: r.category, description: r.description || null, part_number: r.part_number || null, part_id: r.part_id, subcategory: r.subcategory || null,
  quantity: N(r.quantity), unit_cost: N(r.unit_cost), sales_tax_pct: r.sales_tax_pct === '' ? null : N(r.sales_tax_pct)! / 100, markup_pct: r.markup_pct === '' ? null : N(r.markup_pct)! / 100,
  freight_per_unit: N(r.freight_per_unit), markup_applies: r.markup_applies, men: N(r.men), hrs_each: N(r.hrs_each), labor_rate: N(r.labor_rate), travel_days: N(r.travel_days), techs: N(r.techs),
  day_label: r.day_label || null, crew: r.crew, source_note: r.source_note || null, price_flag: r.price_flag, is_stock: r.is_stock, item_type: r.item_type,
})
const pctStr = (v: number | null | undefined, dflt: number) => String(Math.round(((v ?? dflt) * 100 + Number.EPSILON) * 100) / 100)

export function Rev19Builder({ action, header, initialLines, customers, jobs, rateCards, team, currentUser }: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  header: Rev19Header; initialLines?: Rev19Row[]; customers: Customer[]; jobs: Job[]; rateCards: RateCard[]; team: TeamMember[]; currentUser: TeamMember | null
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const isQuote = header.kind === 'quote'
  // Who signs: saved signer, else whoever is building the document. Name and title stay editable.
  const savedName = header.prepared_by?.split(',')[0]?.trim() ?? ''
  const savedTitle = header.prepared_by?.split(',').slice(1).join(',').trim() ?? ''
  const [signerId, setSignerId] = useState(header.signer_id ?? (header.prepared_by ? '' : currentUser?.id ?? ''))
  const [signerName, setSignerName] = useState(savedName || currentUser?.full_name || '')
  const [signerTitle, setSignerTitle] = useState(savedTitle || currentUser?.job_title || '')
  function pickSigner(id: string) {
    setSignerId(id)
    const m = team.find(t => t.id === id)
    if (m) { setSignerName(m.full_name); setSignerTitle(m.job_title ?? '') }
  }
  const [dept, setDept] = useState<'construction' | 'service'>(header.department === 'service' ? 'service' : 'construction')
  const [inputs, setInputs] = useState({
    material_markup_pct: pctStr(header.material_markup_pct, REV19_DEFAULTS.material_markup_pct),
    material_tax_pct: pctStr(header.material_tax_pct, REV19_DEFAULTS.material_tax_pct),
    sub_markup_pct: pctStr(header.sub_markup_pct, REV19_DEFAULTS.sub_markup_pct),
    labor_rate: String(header.labor_rate ?? ''),
    contingency_pct: pctStr(header.contingency_pct, 0), contingency_flat: String(header.contingency_flat ?? 0),
    profit_overhead_percent: pctStr(header.profit_overhead_percent, 0), sales_tax_percent: pctStr(header.sales_tax_percent, 0),
  })
  const [rateCardId, setRateCardId] = useState(header.rate_card_id ?? '')
  const [customerId, setCustomerId] = useState(header.customer_id ?? '')
  const [scope, setScope] = useState<{ scope: string; description: string }[]>(header.scope_rows?.length ? header.scope_rows : [{ scope: '', description: '' }])
  const [lines, setLines] = useState<Rev19Row[]>(initialLines?.length ? initialLines : [])
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const setInp = (k: keyof typeof inputs, v: string) => setInputs(s => ({ ...s, [k]: v }))
  const upd = (key: string, patch: Partial<Rev19Row>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
  const del = (key: string) => setLines(ls => ls.filter(l => l.key !== key))
  const add = (section: 'basic' | 'additional', category: number) => { setLines(ls => [...ls, newRow(section, category, dept)]); setOpen(o => ({ ...o, [`${section}-${category}`]: true })) }

  function pickCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find(x => x.id === id)
    const rc = c?.rate_card_id ? rateCards.find(r => r.id === c.rate_card_id) : rateCards.find(r => c?.brand && r.name.toLowerCase() === c.brand.toLowerCase())
    if (rc) applyRateCard(rc.id)
  }
  function applyRateCard(id: string) {
    setRateCardId(id)
    const rc = rateCards.find(r => r.id === id)
    if (rc) setInp('labor_rate', String(rc.labor_rate))
  }

  const rev19Inputs: Rev19Inputs = useMemo(() => ({
    material_markup_pct: (N(inputs.material_markup_pct) ?? 20) / 100, material_tax_pct: (N(inputs.material_tax_pct) ?? 5.3) / 100, sub_markup_pct: (N(inputs.sub_markup_pct) ?? 15) / 100,
    labor_rate: N(inputs.labor_rate) ?? 0, contingency_pct: (N(inputs.contingency_pct) ?? 0) / 100, contingency_flat: N(inputs.contingency_flat) ?? 0,
    profit_overhead_pct: (N(inputs.profit_overhead_percent) ?? 0) / 100, sales_tax_pct: (N(inputs.sales_tax_percent) ?? 0) / 100,
  }), [inputs])
  const { lines: computed, totals } = useMemo(() => computeRev19(lines.map(toInput), rev19Inputs), [lines, rev19Inputs])
  const ext = (key: string) => computed[lines.findIndex(l => l.key === key)]
  const flagged = computed.filter(l => l.price_flag && l.price_flag !== 'ok')

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="line_items" value={JSON.stringify(lines.map(toInput))} />
      <input type="hidden" name="scope_rows" value={JSON.stringify(scope)} />
      <input type="hidden" name="department" value={dept} />
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="rate_card_id" value={rateCardId} />
      {header.quote_id && <input type="hidden" name="quote_id" value={header.quote_id} />}
      {header.service_ticket_id && <input type="hidden" name="service_ticket_id" value={header.service_ticket_id} />}
      {Object.entries(inputs).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}

      {/* ── HEADER BLOCK ─────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold text-gray-900">{isQuote ? 'Quote header' : 'Invoice header'}</h2>
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5 text-xs">
            {(['construction', 'service'] as const).map(d => <button key={d} type="button" onClick={() => setDept(d)} className={`px-3 py-1 rounded-md capitalize ${dept === d ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>{d}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2"><label className={lbl} htmlFor="b-cust">Customer</label>
            <select id="b-cust" value={customerId} onChange={e => pickCustomer(e.target.value)} className={inp}><option value="">— choose —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className={lbl} htmlFor="b-site">Site / store #</label><input id="b-site" name="site_number" defaultValue={header.site_number ?? ''} className={inp} placeholder="SU-8001" /></div>
          <div><label className={lbl} htmlFor="b-store">Store label</label><input id="b-store" name="store_label" defaultValue={header.store_label ?? ''} className={inp} placeholder="Store 40312" /></div>
          <div className="col-span-2"><label className={lbl} htmlFor="b-addr">Address</label><input id="b-addr" name="facility_address" defaultValue={header.facility_address ?? ''} className={inp} /></div>
          <div className="col-span-2"><label className={lbl} htmlFor="b-csz">City, State, Zip</label><input id="b-csz" name="city_state_zip" defaultValue={header.city_state_zip ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-attn">Attn</label><input id="b-attn" name="attn" defaultValue={header.attn ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-email">Customer email</label><input id="b-email" name="customer_email" defaultValue={header.customer_email ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-csr">SR# / CSR#</label><input id="b-csr" name="csr_number" defaultValue={header.csr_number ?? ''} className={inp} placeholder="WOT0057768" /></div>
          <div><label className={lbl} htmlFor="b-po">PO #</label><input id="b-po" name="po_number" defaultValue={header.po_number ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-wo">Portal WO #</label><input id="b-wo" name="portal_wo_number" defaultValue={header.portal_wo_number ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-job">Construction job</label>
            <select id="b-job" name="job_id" defaultValue={header.job_id ?? ''} className={inp}><option value="">— none —</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.site_number ?? ''} {j.work_order_number ?? ''}</option>)}</select></div>
          {isQuote ? (<>
            <div><label className={lbl} htmlFor="b-date">Quote date</label><input id="b-date" name="proposal_date" type="date" defaultValue={header.proposal_date ?? new Date().toISOString().slice(0, 10)} className={inp} /></div>
            <div><label className={lbl} htmlFor="b-bid">Bid due</label><input id="b-bid" name="bid_due" type="date" defaultValue={header.bid_due ?? ''} className={inp} /></div>
            <div><label className={lbl} htmlFor="b-valid">Valid until</label><input id="b-valid" name="valid_until" type="date" defaultValue={header.valid_until ?? ''} className={inp} /></div>
            <div><label className={lbl} htmlFor="b-nte">NTE $</label><input id="b-nte" name="nte_amount" type="number" step="any" defaultValue={header.nte_amount ?? ''} className={numInp} /></div>
          </>) : (<>
            <div><label className={lbl} htmlFor="b-idate">Invoice date</label><input id="b-idate" name="invoice_date" type="date" defaultValue={header.invoice_date ?? new Date().toISOString().slice(0, 10)} className={inp} /></div>
            <div><label className={lbl} htmlFor="b-due">Due date</label><input id="b-due" name="due_date" type="date" defaultValue={header.due_date ?? ''} className={inp} /></div>
          </>)}
          <div><label className={lbl} htmlFor="b-pm">Project manager</label><input id="b-pm" name="project_manager" list="team-names" defaultValue={header.project_manager ?? currentUser?.full_name ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-cm">Construction manager</label><input id="b-cm" name="construction_manager" list="team-names" defaultValue={header.construction_manager ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-fm">Foreman / lead</label><input id="b-fm" name="foreman" list="team-names" defaultValue={header.foreman ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-cb">Work order compiled by</label><input id="b-cb" name="compiled_by" list="team-names" defaultValue={header.compiled_by ?? currentUser?.full_name ?? ''} className={inp} /></div>
          <datalist id="team-names">{team.map(t => <option key={t.id} value={t.full_name} />)}</datalist>
          <div className="col-span-2 md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div><label className={lbl} htmlFor="b-signer">Signed by</label>
              <select id="b-signer" value={signerId} onChange={e => pickSigner(e.target.value)} className={inp}><option value="">— type a name —</option>{team.map(t => <option key={t.id} value={t.id}>{t.full_name}{t.job_title ? ` · ${t.job_title}` : ''}</option>)}</select>
              <input type="hidden" name="signer_id" value={signerId} /></div>
            <div><label className={lbl} htmlFor="b-signer-name">Name on the signature line</label><input id="b-signer-name" name="signer_name" value={signerName} onChange={e => setSignerName(e.target.value)} className={inp} required /></div>
            <div className="col-span-2"><label className={lbl} htmlFor="b-signer-title">Title under the name</label><input id="b-signer-title" name="signer_title" value={signerTitle} onChange={e => setSignerTitle(e.target.value)} className={inp} placeholder="Construction Manager" /></div>
          </div>
          <div className="col-span-2 md:col-span-4"><label className={lbl} htmlFor="b-desc">Project description</label><input id="b-desc" name="project_description" defaultValue={header.project_description ?? ''} className={inp} placeholder="PRODUCT LINE REPLACEMENT — SU-8001, GLEN BURNIE MD" /></div>
          <div><label className={lbl} htmlFor="b-status">Status</label>
            <select id="b-status" name="status" defaultValue={header.status ?? 'draft'} className={inp}>
              {(isQuote ? [['draft', 'Draft'], ['sent', 'Sent'], ['approved', 'Approved'], ['rejected', 'Rejected']] : [['draft', 'Draft'], ['sent', 'Invoiced'], ['void', 'Void']]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          {isQuote && <div className="col-span-2 flex items-end pb-1"><label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="is_starting_quote" value="true" defaultChecked={header.is_starting_quote !== false} />Starting quote (Starsky finalizes and signs)</label></div>}
        </div>
      </section>

      {/* ── INPUTS BLOCK ─────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Inputs</h2>
        <p className="text-xs text-gray-500 mb-3">Change these and every line re-prices. Tax lives on the material line (categories 1–4) and is recovered through markup, so the quote-level sales tax stays 0.00%.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <div><label className={lbl} htmlFor="i-rc">Rate card</label>
            <select id="i-rc" value={rateCardId} onChange={e => applyRateCard(e.target.value)} className={inp}><option value="">— pick —</option>{rateCards.map(r => <option key={r.id} value={r.id}>{r.name} ${Number(r.labor_rate).toFixed(2)}</option>)}</select></div>
          <div><label className={lbl} htmlFor="i-rate">Labor $/hr</label>
            <input id="i-rate" list="rates" value={inputs.labor_rate} onChange={e => setInp('labor_rate', e.target.value)} type="number" step="0.5" className={numInp} required />
            <datalist id="rates">{LABOR_RATES.map(r => <option key={r.brand} value={r.rate}>{r.brand}</option>)}</datalist></div>
          <div><label className={lbl} htmlFor="i-mk">Material markup %</label><input id="i-mk" value={inputs.material_markup_pct} onChange={e => setInp('material_markup_pct', e.target.value)} type="number" step="0.5" className={numInp} /></div>
          <div><label className={lbl} htmlFor="i-tax">Tax on material %</label>
            <input id="i-tax" list="taxes" value={inputs.material_tax_pct} onChange={e => setInp('material_tax_pct', e.target.value)} type="number" step="0.1" className={numInp} />
            <datalist id="taxes">{TAX_PRESETS.map(t => <option key={t.label} value={t.value * 100}>{t.label}</option>)}</datalist></div>
          <div><label className={lbl} htmlFor="i-sub">Sub markup %</label><input id="i-sub" value={inputs.sub_markup_pct} onChange={e => setInp('sub_markup_pct', e.target.value)} type="number" step="0.5" className={numInp} /></div>
          <div><label className={lbl} htmlFor="i-cont">Contingency %</label><input id="i-cont" value={inputs.contingency_pct} onChange={e => setInp('contingency_pct', e.target.value)} type="number" step="0.5" className={numInp} /></div>
          <div><label className={lbl} htmlFor="i-contf">Contingency $</label><input id="i-contf" value={inputs.contingency_flat} onChange={e => setInp('contingency_flat', e.target.value)} type="number" step="any" className={numInp} /></div>
          <div><label className={lbl} htmlFor="i-po">Profit &amp; overhead %</label><input id="i-po" value={inputs.profit_overhead_percent} onChange={e => setInp('profit_overhead_percent', e.target.value)} type="number" step="0.5" className={numInp} /></div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Project management fee: none, ever. Quote-level sales tax: {inputs.sales_tax_percent}% (leave at 0).</p>
      </section>

      {/* ── SCOPE ────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900">Scope of work</h2><button type="button" onClick={() => setScope(s => [...s, { scope: '', description: '' }])} className="text-sm text-blue-600">+ Row</button></div>
        <div className="space-y-2">
          {scope.map((r, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <input value={r.scope} onChange={e => setScope(s => s.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)))} className={`${inp} md:col-span-2 font-medium`} placeholder="SCOPE (e.g. FURNISH & INSTALL FL100'S (3))" aria-label="Scope" />
              <div className="md:col-span-3 flex gap-2"><textarea value={r.description} onChange={e => setScope(s => s.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} rows={2} className={inp} placeholder="DESCRIPTION OF WORK in RPS voice" aria-label="Description" />
                <button type="button" onClick={() => setScope(s => s.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove scope row"><Trash2 className="w-4 h-4" /></button></div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTIONS × CATEGORIES ────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 space-y-5">
          {(['basic', 'additional'] as const).map(section => (
            <section key={section} className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-gray-900">{section === 'basic' ? 'Basic installation' : 'Additional scope of work (change order)'}</h2>
                <AddMenu onAdd={c => add(section, c)} />
              </div>
              <div className="divide-y divide-gray-100">
                {REV19_CATEGORIES.map(c => {
                  const rows = lines.filter(l => l.section === section && l.category === c.n)
                  const k = `${section}-${c.n}`
                  const isOpen = open[k] ?? rows.length > 0
                  const faceRow = totals[section].rows.find(r => r.n === c.n)
                  if (!rows.length && !open[k]) return null
                  return (
                    <div key={k}>
                      <button type="button" onClick={() => setOpen(o => ({ ...o, [k]: !isOpen }))} className="w-full px-5 py-2.5 flex items-center gap-2 text-left hover:bg-gray-50">
                        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        <span className="text-xs font-mono text-gray-400 w-6">{c.n}</span>
                        <span className="font-medium text-gray-900 text-sm">{c.name}</span>
                        <span className="ml-auto text-sm tabular-nums text-gray-700">{faceRow ? money(faceRow.total) : '—'}</span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3">
                          <CategoryTable kind={c.kind} rows={rows} upd={upd} del={del} ext={ext} inputs={rev19Inputs} dept={dept} />
                          <div className="flex items-center justify-between mt-2 px-2">
                            <button type="button" onClick={() => add(section, c.n)} className="text-xs text-blue-600 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add line</button>
                            {c.n === 11 && rows.length > 0 && <span className="text-xs text-gray-500">+ {inputs.sub_markup_pct}% subcontractor markup on this category = {money((faceRow?.material ?? 0))}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {!lines.some(l => l.section === section) && <p className="px-5 py-6 text-sm text-gray-400">{section === 'basic' ? 'No lines yet. Use "Add to category" to start with material, labor by day, mobilization, equipment…' : 'No change-order lines.'}</p>}
              </div>
            </section>
          ))}

          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className={lbl} htmlFor="b-excl">Exclusions and clarifications</label><textarea id="b-excl" name="exclusions" rows={4} defaultValue={header.exclusions ?? ''} className={inp} placeholder="Price does not include… Dewatering priced per day… Third-party testing by others…" /></div>
            <div><label className={lbl} htmlFor="b-warr">Warranty line</label><textarea id="b-warr" name="warranty_line" rows={4} defaultValue={header.warranty_line ?? ''} className={inp} placeholder="Work warranty 1 year." /></div>
          </section>
        </div>

        {/* ── LIVE FACE ──────────────────────────────────────── */}
        <aside className="xl:sticky xl:top-4 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <h2 className="px-4 py-3 font-semibold text-gray-900 border-b border-gray-100 text-sm">{isQuote ? 'Quote face' : 'Invoice face'}</h2>
            {(['basic', 'additional'] as const).map(s => totals[s].rows.length > 0 && (
              <div key={s}>
                <div className="px-4 py-1.5 bg-gray-50 text-[11px] font-semibold text-gray-600 uppercase">{s === 'basic' ? 'Basic installation' : 'Additional scope'}</div>
                <table className="w-full text-xs"><tbody>
                  {totals[s].rows.map(r => <tr key={r.n} className="border-b border-gray-50"><td className="px-4 py-1 text-gray-400 w-6">{r.n}</td><td className="py-1 text-gray-800">{categoryMeta(r.n).short}{r.n === 7 && r.labor_hours ? <span className="text-gray-400"> · {r.labor_hours} hrs @ {money(r.labor_rate)}</span> : null}</td><td className="px-4 py-1 text-right tabular-nums">{money(r.total)}</td></tr>)}
                  <tr className="bg-gray-50 font-medium"><td /><td className="py-1 text-gray-700">Material {money(totals[s].subtotal_material)} · Labor {money(totals[s].subtotal_labor)}</td><td className="px-4 py-1 text-right tabular-nums">{money(totals[s].total)}</td></tr>
                </tbody></table>
              </div>
            ))}
            <table className="w-full text-xs"><tbody>
              <tr><td className="px-4 py-1 text-gray-500">Taxable materials (1–4)</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.taxable_material_total)}</td></tr>
              <tr><td className="px-4 py-1 text-gray-500">Concrete, equipment, subs, disposal, permits (5+9+10+11+12)</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.concrete_equipment_total)}</td></tr>
              <tr><td className="px-4 py-1 text-gray-500">Labor, mobilization, lodging (6+7+8)</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.labor_mobilization_total)}</td></tr>
              <tr className="border-t border-gray-200"><td className="px-4 py-1.5 font-medium text-gray-800">Grand total</td><td className="px-4 py-1.5 text-right tabular-nums font-medium">{money(totals.grand_total)}</td></tr>
              {totals.contingency_amount !== 0 && <tr><td className="px-4 py-1 text-gray-500">Contingency</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.contingency_amount)}</td></tr>}
              {totals.profit_overhead_amount !== 0 && <tr><td className="px-4 py-1 text-gray-500">Profit &amp; overhead</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.profit_overhead_amount)}</td></tr>}
              {totals.tax_amount !== 0 && <tr><td className="px-4 py-1 text-gray-500">Sales tax</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.tax_amount)}</td></tr>}
              <tr className="bg-blue-50 border-t border-blue-100"><td className="px-4 py-2 font-semibold text-blue-900">{isQuote ? 'Proposal grand total' : 'Invoice grand total'}</td><td className="px-4 py-2 text-right tabular-nums font-bold text-blue-900">{money(totals.final_total)}</td></tr>
            </tbody></table>
          </div>
          {flagged.length > 0 && (
            <div className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-xs text-pink-900">
              <b>Price gap list ({flagged.length})</b>
              <ul className="mt-1 space-y-0.5">{flagged.slice(0, 8).map((l, i) => <li key={i}>{PRICE_FLAG_LABEL[l.price_flag ?? ''] || l.price_flag} — {l.description || l.part_number || `category ${l.category}`}</li>)}</ul>
            </div>
          )}
          <Button type="submit" disabled={pending} className="w-full">{pending ? 'Saving…' : isQuote ? (header.id ? 'Save quote' : 'Create quote') : (header.id ? 'Save invoice' : 'Create invoice')}</Button>
        </aside>
      </div>
    </form>
  )
}

function AddMenu({ onAdd }: { onAdd: (category: number) => void }) {
  const [v, setV] = useState('')
  return (
    <select value={v} onChange={e => { const c = Number(e.target.value); if (c) onAdd(c); setV('') }} className="rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm px-3 py-1.5" aria-label="Add to category">
      <option value="">+ Add to category…</option>
      {REV19_CATEGORIES.map(c => <option key={c.n} value={c.n}>{c.n} · {c.name}</option>)}
    </select>
  )
}

type TableProps = { kind: string; rows: Rev19Row[]; upd: (k: string, p: Partial<Rev19Row>) => void; del: (k: string) => void; ext: (k: string) => ReturnType<typeof computeRev19>['lines'][number] | undefined; inputs: Rev19Inputs; dept: 'construction' | 'service' }

function CategoryTable({ kind, rows, upd, del, ext, inputs, dept }: TableProps) {
  const th = 'text-left px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wide'
  const thr = `${th} text-right`
  const pick = (r: Rev19Row, p: PickedPart) => {
    const isMaterial = kind === 'material'
    upd(r.key, {
      description: p.description, part_number: p.part_number ?? '', part_id: p.id, unit_cost: p.unit_cost != null ? String(p.unit_cost) : '', freight_per_unit: p.freight_per_unit ? String(p.freight_per_unit) : '',
      sales_tax_pct: isMaterial && p.taxable === false ? '0' : r.sales_tax_pct, item_type: p.item_type ?? r.item_type,
      source_note: [p.cost_source?.toUpperCase(), p.cost_vendor, p.cost_invoice_ref, p.cost_date ? p.cost_date.slice(0, 10) : null].filter(Boolean).join(' · '),
      price_flag: p.unit_cost == null ? 'price_needed' : p.price_status === 'held_high' ? 'held_high' : p.price_status === 'verify' || (p.cost_date && Date.now() - new Date(p.cost_date).getTime() > 183 * 86_400_000) ? 'verify' : 'ok',
    })
  }
  const Desc = ({ r, placeholder }: { r: Rev19Row; placeholder: string }) => (
    <PartPicker value={r.description} onChange={t => upd(r.key, { description: t, part_id: null })} onPick={p => pick(r, p)} className={inp} placeholder={placeholder} />
  )
  const Flag = ({ r }: { r: Rev19Row }) => (
    <select value={r.price_flag} onChange={e => upd(r.key, { price_flag: e.target.value })} className={`${inp} w-24 text-[11px] ${r.price_flag !== 'ok' ? 'bg-pink-50 border-pink-300 text-pink-800' : ''}`} aria-label="Price flag">
      <option value="ok">ok</option><option value="estimate">estimate</option><option value="price_needed">PRICE NEEDED</option><option value="held_high">HELD HIGH</option><option value="verify">verify</option>{kind === 'labor' && <option value="hours_needed">HOURS NEEDED</option>}
    </select>
  )
  const Note = ({ r }: { r: Rev19Row }) => <input value={r.source_note} onChange={e => upd(r.key, { source_note: e.target.value })} className={`${inp} min-w-[160px] text-xs`} placeholder="RECEIPT SNA 2628199 6/26/26" aria-label="Where the price came from" />
  const Del = ({ r }: { r: Rev19Row }) => <button type="button" onClick={() => del(r.key)} className="text-gray-300 hover:text-red-600" aria-label="Remove line"><Trash2 className="w-4 h-4" /></button>

  if (kind === 'material') return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr><th className={`${th} min-w-[260px]`}>Part # / description</th><th className={thr}>Cost</th><th className={thr}>Tax %</th><th className={thr}>Markup %</th><th className={thr}>Freight</th><th className={thr}>Sell</th><th className={thr}>Qty</th><th className={thr}>Extended</th><th className={th}>Source</th><th /><th /></tr></thead>
      <tbody>{rows.map(r => { const c = ext(r.key); return (
        <tr key={r.key} className="align-top">
          <td className="px-1 py-1"><Desc r={r} placeholder="Type a part number or description…" />{r.part_number && <div className="text-[11px] font-mono text-gray-400 mt-0.5">{r.part_number}</div>}</td>
          <td className="px-1 py-1"><input value={r.unit_cost} onChange={e => upd(r.key, { unit_cost: e.target.value })} type="number" step="any" className={`${numInp} w-24`} aria-label="Unit cost" /></td>
          <td className="px-1 py-1"><input value={r.sales_tax_pct} onChange={e => upd(r.key, { sales_tax_pct: e.target.value })} type="number" step="0.1" className={`${numInp} w-16`} placeholder={String(inputs.material_tax_pct * 100)} aria-label="Tax percent" /></td>
          <td className="px-1 py-1"><input value={r.markup_pct} onChange={e => upd(r.key, { markup_pct: e.target.value })} type="number" step="0.5" className={`${numInp} w-16`} placeholder={String(inputs.material_markup_pct * 100)} aria-label="Markup percent" /></td>
          <td className="px-1 py-1"><input value={r.freight_per_unit} onChange={e => upd(r.key, { freight_per_unit: e.target.value })} type="number" step="any" className={`${numInp} w-20`} aria-label="Freight per unit" /></td>
          <td className="px-1 py-1 text-right tabular-nums text-gray-700 pt-2 whitespace-nowrap">{c ? money(c.sell_unit) : '—'}</td>
          <td className="px-1 py-1"><input value={r.quantity} onChange={e => upd(r.key, { quantity: e.target.value })} type="number" step="any" className={`${numInp} w-20`} aria-label="Quantity" /></td>
          <td className="px-1 py-1 text-right tabular-nums font-medium pt-2 whitespace-nowrap">{c ? money(c.material_total) : '—'}</td>
          <td className="px-1 py-1"><Note r={r} /></td><td className="px-1 py-1"><Flag r={r} /></td><td className="px-1 py-1 pt-2"><Del r={r} /></td>
        </tr>) })}</tbody>
    </table></div>
  )
  if (kind === 'labor') return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr><th className={th}>Day</th><th className={`${th} min-w-[260px]`}>Scope of work for that day</th><th className={th}>Crew</th><th className={thr}>Rate</th><th className={thr}>Men</th><th className={thr}>Hrs each</th><th className={thr}>Hours</th><th className={thr}>Extended</th><th className={th}>Note</th><th /><th /></tr></thead>
      <tbody>{rows.map((r, i) => { const c = ext(r.key); return (
        <tr key={r.key} className="align-top">
          <td className="px-1 py-1"><input value={r.day_label} onChange={e => upd(r.key, { day_label: e.target.value })} className={`${inp} w-24`} placeholder={`DAY ${i + 1}`} aria-label="Day" /></td>
          <td className="px-1 py-1"><input value={r.description} onChange={e => upd(r.key, { description: e.target.value })} className={inp} placeholder="MOBILIZE, BARRICADE ISLANDS, DRAIN AND PULL…" aria-label="Scope" /></td>
          <td className="px-1 py-1"><select value={r.crew} onChange={e => upd(r.key, { crew: e.target.value as 'construction' | 'service' })} className={`${inp} w-28`} aria-label="Crew"><option value="construction">Construction</option><option value="service">Service tech</option></select></td>
          <td className="px-1 py-1"><input value={r.labor_rate} onChange={e => upd(r.key, { labor_rate: e.target.value })} type="number" step="0.5" className={`${numInp} w-20`} placeholder={String(inputs.labor_rate)} aria-label="Rate override" /></td>
          <td className="px-1 py-1"><input value={r.men} onChange={e => upd(r.key, { men: e.target.value })} type="number" step="1" className={`${numInp} w-16`} aria-label="Men" /></td>
          <td className="px-1 py-1"><input value={r.hrs_each} onChange={e => upd(r.key, { hrs_each: e.target.value })} type="number" step="0.25" className={`${numInp} w-20`} aria-label="Hours each" /></td>
          <td className="px-1 py-1 text-right tabular-nums pt-2">{c?.labor_hours ?? 0}</td>
          <td className="px-1 py-1 text-right tabular-nums font-medium pt-2 whitespace-nowrap">{c ? money(c.total_labor) : '—'}</td>
          <td className="px-1 py-1"><Note r={r} /></td><td className="px-1 py-1"><Flag r={r} /></td><td className="px-1 py-1 pt-2"><Del r={r} /></td>
        </tr>) })}</tbody>
    </table></div>
  )
  if (kind === 'trip') return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr><th className={th}>Trip</th><th className={`${th} min-w-[220px]`}>Description</th><th className={th}>Crew</th><th className={thr}>Rate</th><th className={thr}>Travel days</th><th className={thr}>Techs</th><th className={thr}>Tech-travel-days</th><th className={thr}>Extended</th><th /></tr></thead>
      <tbody>{rows.map((r, i) => { const c = ext(r.key); return (
        <tr key={r.key} className="align-top">
          <td className="px-1 py-1"><input value={r.day_label} onChange={e => upd(r.key, { day_label: e.target.value })} className={`${inp} w-24`} placeholder={`WEEK ${i + 1}`} aria-label="Trip label" /></td>
          <td className="px-1 py-1"><input value={r.description} onChange={e => upd(r.key, { description: e.target.value })} className={inp} placeholder="OUT MONDAY, HOME FRIDAY" aria-label="Description" /></td>
          <td className="px-1 py-1"><select value={r.crew} onChange={e => upd(r.key, { crew: e.target.value as 'construction' | 'service' })} className={`${inp} w-28`} aria-label="Crew"><option value="construction">Construction</option><option value="service">Service tech</option></select></td>
          <td className="px-1 py-1"><input value={r.unit_cost} onChange={e => upd(r.key, { unit_cost: e.target.value })} type="number" step="any" className={`${numInp} w-20`} aria-label="Rate" /></td>
          <td className="px-1 py-1"><input value={r.travel_days} onChange={e => upd(r.key, { travel_days: e.target.value })} type="number" step="1" className={`${numInp} w-16`} aria-label="Travel days" /></td>
          <td className="px-1 py-1"><input value={r.techs} onChange={e => upd(r.key, { techs: e.target.value })} type="number" step="1" className={`${numInp} w-16`} aria-label="Techs" /></td>
          <td className="px-1 py-1 text-right tabular-nums pt-2">{c?.quantity_effective ?? 0}</td>
          <td className="px-1 py-1 text-right tabular-nums font-medium pt-2 whitespace-nowrap">{c ? money(c.material_total) : '—'}</td>
          <td className="px-1 py-1 pt-2"><Del r={r} /></td>
        </tr>) })}</tbody>
    </table></div>
  )
  // costplus (5, 9, 10, 12), sub (11), lodging (6)
  const isSub = kind === 'sub', isLodging = kind === 'lodging'
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr><th className={`${th} min-w-[260px]`}>Item / description</th><th className={thr}>{isLodging ? 'Rate' : 'Cost'}</th>{!isSub && !isLodging && <th className={th}>Markup?</th>}<th className={thr}>Sell</th><th className={thr}>{isLodging ? 'Tech-nights' : 'Qty'}</th><th className={thr}>Extended</th><th className={th}>Source</th><th /><th /></tr></thead>
      <tbody>{rows.map(r => { const c = ext(r.key); return (
        <tr key={r.key} className="align-top">
          <td className="px-1 py-1"><Desc r={r} placeholder={isSub ? 'Vendor and what they do (orange = sub)' : isLodging ? 'LODGING / PER DIEM COMBINED — 4 TECHS × 4 NIGHTS' : 'SKID STEER WITH FORKS — PER DAY'} /></td>
          <td className="px-1 py-1"><input value={r.unit_cost} onChange={e => upd(r.key, { unit_cost: e.target.value })} type="number" step="any" className={`${numInp} w-24`} aria-label="Cost" /></td>
          {!isSub && !isLodging && <td className="px-1 py-1 text-center pt-2"><input type="checkbox" checked={r.markup_applies} onChange={e => upd(r.key, { markup_applies: e.target.checked })} aria-label="Apply markup" /></td>}
          <td className="px-1 py-1 text-right tabular-nums text-gray-700 pt-2 whitespace-nowrap">{c ? money(c.sell_unit) : '—'}</td>
          <td className="px-1 py-1"><input value={r.quantity} onChange={e => upd(r.key, { quantity: e.target.value })} type="number" step="any" className={`${numInp} w-20`} aria-label="Quantity" /></td>
          <td className="px-1 py-1 text-right tabular-nums font-medium pt-2 whitespace-nowrap">{c ? money(c.material_total) : '—'}</td>
          <td className="px-1 py-1"><Note r={r} /></td><td className="px-1 py-1"><Flag r={r} /></td><td className="px-1 py-1 pt-2"><Del r={r} /></td>
        </tr>) })}</tbody>
    </table></div>
  )
}

/** Turn saved line rows back into builder state. */
export function rowsFromLines(items: Record<string, unknown>[]): Rev19Row[] {
  const S = (v: unknown) => (v == null ? '' : String(v))
  return items.map((it, i) => {
    const legacyLabor = Number(it.labor_hours) > 0 && it.unit_cost == null && it.men == null
    const cat = legacyLabor ? 7 : Number(it.category) || 4
    const base = newRow(it.section === 'additional' ? 'additional' : 'basic', cat, it.crew === 'service' ? 'service' : 'construction')
    return {
      ...base, key: `s${i}`, description: S(it.description), part_number: S(it.part_number), part_id: (it.part_id as string | null) ?? null, subcategory: S(it.subcategory),
      quantity: categoryMeta(cat).kind === 'labor' || categoryMeta(cat).kind === 'trip' ? '' : S(it.quantity), unit_cost: S(it.unit_cost),
      sales_tax_pct: it.sales_tax_pct != null ? String(Number(it.sales_tax_pct) * 100) : '', markup_pct: it.markup_pct != null ? String(Number(it.markup_pct) * 100) : '',
      freight_per_unit: it.freight_per_unit ? S(it.freight_per_unit) : '', markup_applies: !!it.markup_applies,
      men: S(it.men), hrs_each: S(it.hrs_each), labor_rate: it.category === 7 && it.men == null && it.labor_rate != null ? S(it.labor_rate) : '', travel_days: S(it.travel_days), techs: S(it.techs),
      day_label: S(it.day_label), source_note: S(it.source_note), price_flag: S(it.price_flag) || 'ok', is_stock: !!it.is_stock, item_type: S(it.item_type) || base.item_type,
      // legacy lines (no men/hrs) keep their hours via quantity fallback
      ...(cat === 7 && it.men == null && it.labor_hours != null ? { men: '1', hrs_each: S(it.labor_hours), labor_rate: S(it.labor_rate) } : {}),
      ...(cat === 8 && it.travel_days == null && it.quantity != null ? { travel_days: S(it.quantity), techs: '1' } : {}),
    }
  })
}
