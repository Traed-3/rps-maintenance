'use client'

import { useActionState, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Plus, Trash2 } from 'lucide-react'
import { computeDocumentTotals, money, type LineItemInput } from '@/lib/construction'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

type Customer = { id: string; name: string }
type Job = { id: string; site_number: string | null; work_order_number: string | null }

export type LineRowState = {
  key: string
  section: 'basic' | 'additional'
  description: string
  quantity: string
  unit_cost: string
  labor_hours: string
  labor_rate: string
  item_type: string
  is_stock: boolean
}

export type DocHeader = {
  id?: string
  job_id?: string | null
  customer_id?: string | null
  quote_id?: string | null
  attn?: string | null
  customer_email?: string | null
  store_label?: string | null
  facility_address?: string | null
  city_state_zip?: string | null
  project_description?: string | null
  profit_overhead_percent?: number   // whole number, e.g. 10
  sales_tax_percent?: number          // whole number, e.g. 6
  status?: string
  prepared_by?: string | null
  proposal_date?: string | null
  sent_date?: string | null
  decision_date?: string | null
  invoice_date?: string | null
  csr_number?: string | null
  po_number?: string | null
  due_date?: string | null
  paid_date?: string | null
}

let _k = 0
function emptyRow(section: 'basic' | 'additional'): LineRowState {
  return { key: `r${_k++}`, section, description: '', quantity: '', unit_cost: '', labor_hours: '', labor_rate: '', item_type: 'material', is_stock: false }
}

const ITEM_TYPES = ['material', 'labor', 'trip', 'disposables', 'sub']
const STATUS_OPTIONS: Record<'quote' | 'invoice', { value: string; label: string }[]> = {
  quote: [
    { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' },
    { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
  ],
  invoice: [
    { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' },
    { value: 'paid', label: 'Paid' }, { value: 'overdue', label: 'Overdue' }, { value: 'void', label: 'Void' },
  ],
}

export function DocBuilder({
  mode,
  action,
  header,
  initialLines,
  customers,
  jobs,
}: {
  mode: 'quote' | 'invoice'
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  header?: DocHeader
  initialLines?: LineRowState[]
  customers: Customer[]
  jobs: Job[]
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [lines, setLines] = useState<LineRowState[]>(
    initialLines && initialLines.length ? initialLines : [emptyRow('basic')]
  )
  const [poPct, setPoPct] = useState<string>(String(header?.profit_overhead_percent ?? 0))
  const [taxPct, setTaxPct] = useState<string>(String(header?.sales_tax_percent ?? 0))

  function update(key: string, patch: Partial<LineRowState>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }
  function addRow(section: 'basic' | 'additional') {
    setLines(prev => [...prev, emptyRow(section)])
  }
  function removeRow(key: string) {
    setLines(prev => prev.filter(l => l.key !== key))
  }

  // Live totals — mirror of the server-side recompute so the user sees the math.
  const { totals, lineInputs } = useMemo(() => {
    const lineInputs: LineItemInput[] = lines.map((l, i) => ({
      section: l.section,
      line_no: i + 1,
      description: l.description || null,
      quantity: l.quantity ? Number(l.quantity) : null,
      unit_cost: l.unit_cost ? Number(l.unit_cost) : null,
      labor_hours: l.labor_hours ? Number(l.labor_hours) : null,
      labor_rate: l.labor_rate ? Number(l.labor_rate) : null,
      item_type: l.item_type || null,
      is_stock: l.is_stock,
    }))
    const { totals } = computeDocumentTotals(lineInputs, (Number(poPct) || 0) / 100, (Number(taxPct) || 0) / 100)
    return { totals, lineInputs }
  }, [lines, poPct, taxPct])

  const finalLabel = mode === 'quote' ? 'Final Total' : 'Invoice Total'

  function Section({ section, title }: { section: 'basic' | 'additional'; title: string }) {
    const rows = lines.filter(l => l.section === section)
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={() => addRow(section)} className="text-sm font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" />Add line
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left font-medium px-3 py-2 w-64">Description</th>
                <th className="text-left font-medium px-2 py-2">Type</th>
                <th className="text-right font-medium px-2 py-2">Qty</th>
                <th className="text-right font-medium px-2 py-2">Unit $</th>
                <th className="text-right font-medium px-2 py-2">Hrs</th>
                <th className="text-right font-medium px-2 py-2">Rate</th>
                <th className="text-right font-medium px-2 py-2">Line $</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(l => {
                const matTotal = (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)
                const labTotal = (Number(l.labor_hours) || 0) * (Number(l.labor_rate) || 0)
                return (
                  <tr key={l.key}>
                    <td className="px-3 py-1.5">
                      <input value={l.description} onChange={e => update(l.key, { description: e.target.value })} className={inp} placeholder="Description" />
                      <label className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400">
                        <input type="checkbox" checked={l.is_stock} onChange={e => update(l.key, { is_stock: e.target.checked })} className="rounded border-gray-300" />
                        Stock
                      </label>
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={l.item_type} onChange={e => update(l.key, { item_type: e.target.value })} className={inp}>
                        {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 w-20"><input value={l.quantity} onChange={e => update(l.key, { quantity: e.target.value })} type="number" step="any" className={`${inp} text-right`} /></td>
                    <td className="px-2 py-1.5 w-24"><input value={l.unit_cost} onChange={e => update(l.key, { unit_cost: e.target.value })} type="number" step="any" className={`${inp} text-right`} /></td>
                    <td className="px-2 py-1.5 w-20"><input value={l.labor_hours} onChange={e => update(l.key, { labor_hours: e.target.value })} type="number" step="any" className={`${inp} text-right`} /></td>
                    <td className="px-2 py-1.5 w-24"><input value={l.labor_rate} onChange={e => update(l.key, { labor_rate: e.target.value })} type="number" step="any" className={`${inp} text-right`} /></td>
                    <td className="px-2 py-1.5 text-right font-medium text-gray-800 whitespace-nowrap">{money(matTotal + labTotal)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" onClick={() => removeRow(l.key)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-4 text-center text-sm text-gray-400">No lines. Click “Add line”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      {/* Serialized line items + live percents */}
      <input type="hidden" name="line_items" value={JSON.stringify(lineInputs)} />
      {header?.quote_id && <input type="hidden" name="quote_id" value={header.quote_id} />}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Job</label>
          <select name="job_id" className={inp} defaultValue={header?.job_id ?? ''}>
            <option value="">— Not linked —</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.site_number ?? '—'}{j.work_order_number ? ` (${j.work_order_number})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Customer</label>
          <select name="customer_id" className={inp} defaultValue={header?.customer_id ?? ''}>
            <option value="">— No customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Attn</label>
          <input name="attn" className={inp} defaultValue={header?.attn ?? ''} />
        </div>
        {mode === 'quote' ? (
          <div>
            <label className={lbl}>Customer Email</label>
            <input name="customer_email" type="email" className={inp} defaultValue={header?.customer_email ?? ''} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>CSR #</label><input name="csr_number" className={inp} defaultValue={header?.csr_number ?? ''} /></div>
            <div><label className={lbl}>PO #</label><input name="po_number" className={inp} defaultValue={header?.po_number ?? ''} /></div>
          </div>
        )}
        <div>
          <label className={lbl}>Store Label</label>
          <input name="store_label" className={inp} defaultValue={header?.store_label ?? ''} />
        </div>
        <div>
          <label className={lbl}>Facility Address</label>
          <input name="facility_address" className={inp} defaultValue={header?.facility_address ?? ''} />
        </div>
        <div>
          <label className={lbl}>City / State / ZIP</label>
          <input name="city_state_zip" className={inp} defaultValue={header?.city_state_zip ?? ''} />
        </div>
        <div>
          <label className={lbl}>{mode === 'quote' ? 'Proposal Date' : 'Invoice Date'}</label>
          <input name={mode === 'quote' ? 'proposal_date' : 'invoice_date'} type="date" className={inp}
            defaultValue={(mode === 'quote' ? header?.proposal_date : header?.invoice_date) ?? ''} />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Project Description</label>
          <textarea name="project_description" rows={2} className={inp} defaultValue={header?.project_description ?? ''} />
        </div>
        <div>
          <label className={lbl}>Status</label>
          <select name="status" className={inp} defaultValue={header?.status ?? 'draft'}>
            {STATUS_OPTIONS[mode].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Prepared By</label>
          <input name="prepared_by" className={inp} defaultValue={header?.prepared_by ?? 'Starsky Dodson, Construction Manager'} />
        </div>
        {mode === 'invoice' && (
          <>
            <div><label className={lbl}>Due Date</label><input name="due_date" type="date" className={inp} defaultValue={header?.due_date ?? ''} /></div>
            <div><label className={lbl}>Paid Date</label><input name="paid_date" type="date" className={inp} defaultValue={header?.paid_date ?? ''} /></div>
          </>
        )}
        {mode === 'quote' && (
          <>
            <div><label className={lbl}>Sent Date</label><input name="sent_date" type="date" className={inp} defaultValue={header?.sent_date ?? ''} /></div>
            <div><label className={lbl}>Decision Date</label><input name="decision_date" type="date" className={inp} defaultValue={header?.decision_date ?? ''} /></div>
          </>
        )}
      </div>

      <Section section="basic" title="Basic Installation" />
      <Section section="additional" title="Additional Scope" />

      {/* Percents + totals */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <label className={lbl}>Profit &amp; Overhead %</label>
            <input name="profit_overhead_percent" value={poPct} onChange={e => setPoPct(e.target.value)} type="number" step="any" className={`${inp} max-w-32`} />
          </div>
          <div>
            <label className={lbl}>Sales Tax % <span className="font-normal text-gray-400">(materials only)</span></label>
            <input name="sales_tax_percent" value={taxPct} onChange={e => setTaxPct(e.target.value)} type="number" step="any" className={`${inp} max-w-32`} />
          </div>
        </div>
        <div className="text-sm space-y-1.5">
          <Row label="Basic — Material" value={money(totals.basic_subtotal_material)} />
          <Row label="Basic — Labor" value={money(totals.basic_subtotal_labor)} />
          <Row label="Basic Total" value={money(totals.basic_total)} bold />
          <Row label="Additional — Material" value={money(totals.additional_subtotal_material)} />
          <Row label="Additional — Labor" value={money(totals.additional_subtotal_labor)} />
          <Row label="Additional Total" value={money(totals.additional_total)} bold />
          <div className="border-t border-gray-100 my-1" />
          <Row label="Grand Total" value={money(totals.grand_total)} bold />
          <Row label="Profit & Overhead" value={money(totals.profit_overhead_amount)} />
          <Row label="Sales Tax" value={money(totals.tax_amount)} />
          <div className="border-t border-gray-200 my-1" />
          <Row label={finalLabel} value={money(totals.final_total)} big />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : header?.id ? 'Save Changes' : mode === 'quote' ? 'Create Quote' : 'Create Invoice'}</Button>
        <a href={mode === 'quote' ? '/construction/quotes' : '/construction/invoices'} className="text-sm text-gray-500 hover:text-gray-700">Cancel</a>
      </div>
    </form>
  )
}

function Row({ label, value, bold, big }: { label: string; value: string; bold?: boolean; big?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={big ? 'text-base font-semibold text-gray-900' : bold ? 'font-medium text-gray-800' : 'text-gray-500'}>{label}</span>
      <span className={big ? 'text-lg font-bold text-gray-900' : bold ? 'font-semibold text-gray-900' : 'text-gray-700'}>{value}</span>
    </div>
  )
}
