import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { money, fmtDate, stageMeta, CON_STAGES } from '@/lib/construction'
import { jobCostRows, sumBy } from '@/lib/construction-reports'
import { Download } from 'lucide-react'

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)

export default async function ReportsPage() {
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()

  const rows = await jobCostRows(admin, company_id)
  const byCustomer = sumBy(rows, 'customer')
  const byProgram = sumBy(rows, 'program')

  const totals = rows.reduce((a, r) => ({
    quoted: a.quoted + r.quoted, invoiced: a.invoiced + r.invoiced,
    cost: a.cost + r.materialCost + r.laborCost, margin: a.margin + r.margin,
  }), { quoted: 0, invoiced: 0, cost: 0, margin: 0 })

  // Pipeline aging by stage
  const { data: openJobs } = await admin
    .from('con_jobs').select('stage, date_received').eq('company_id', company_id).neq('stage', 'complete')
  const today = new Date()
  const aging = CON_STAGES.filter(s => s.value !== 'complete').map(s => {
    const inStage = (openJobs ?? []).filter(j => j.stage === s.value)
    const ages = inStage.map(j => j.date_received ? Math.floor((today.getTime() - new Date(j.date_received + 'T00:00:00').getTime()) / 86400000) : null).filter((x): x is number => x != null)
    const avg = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null
    return { stage: s.value, label: s.label, count: inStage.length, avgAge: avg }
  }).filter(s => s.count > 0)

  // A/R aging
  const { data: openInv } = await admin
    .from('con_invoices').select('id, invoice_number, status, invoice_grand_total, due_date, sent_date, con_customers(name)')
    .eq('company_id', company_id).in('status', ['sent', 'overdue']).order('due_date', { nullsFirst: false })
  const todayIso = iso(today)
  const ar = (openInv ?? []).map(inv => {
    const days = inv.due_date ? Math.floor((today.getTime() - new Date(inv.due_date + 'T00:00:00').getTime()) / 86400000) : 0
    return { ...inv, daysOverdue: inv.due_date && inv.due_date < todayIso ? days : 0 }
  })
  const arTotal = ar.reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
            Construction Reports
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Job cost · margin · pipeline aging · A/R</p>
        </div>
        <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Total Quoted" value={money(totals.quoted)} />
        <Stat label="Total Invoiced" value={money(totals.invoiced)} />
        <Stat label="Total Cost (Mat+Labor)" value={money(totals.cost)} />
        <Stat label="Total Margin" value={money(totals.margin)} accent={totals.margin >= 0 ? 'text-green-700' : 'text-red-700'} sub={totals.invoiced > 0 ? `${((totals.margin / totals.invoiced) * 100).toFixed(1)}%` : undefined} />
      </div>

      {/* Job cost */}
      <Section title="Job Cost" csv="job_cost">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-4 py-2 font-medium">Job</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Customer</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Stage</th>
                <th className="text-right px-4 py-2 font-medium">Quoted</th>
                <th className="text-right px-4 py-2 font-medium">Invoiced</th>
                <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">Material</th>
                <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">Labor</th>
                <th className="text-right px-4 py-2 font-medium">Margin</th>
                <th className="text-right px-4 py-2 font-medium hidden md:table-cell">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">No jobs yet.</td></tr>
              ) : rows.map(r => (
                <tr key={r.jobId} className="hover:bg-gray-50">
                  <td className="px-4 py-2"><Link href={`/construction/jobs/${r.jobId}?tab=cost`} className="font-medium text-blue-600 hover:text-blue-800">{r.site}</Link></td>
                  <td className="px-4 py-2 text-gray-600 hidden md:table-cell">{r.customer || '—'}</td>
                  <td className="px-4 py-2 hidden lg:table-cell text-xs text-gray-500">{stageMeta(r.stage).label}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{money(r.quoted)}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{money(r.invoiced)}</td>
                  <td className="px-4 py-2 text-right text-gray-500 hidden sm:table-cell">{money(r.materialCost)}</td>
                  <td className="px-4 py-2 text-right text-gray-500 hidden sm:table-cell">{money(r.laborCost)}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${r.margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>{money(r.margin)}</td>
                  <td className="px-4 py-2 text-right text-gray-500 hidden md:table-cell">{pct(r.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-6">
        <MarginTable title="Margin by Customer" rows={byCustomer} />
        <MarginTable title="Margin by Program" rows={byProgram} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-6">
        {/* Pipeline aging */}
        <Section title="Pipeline Aging" csv="pipeline">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {aging.length === 0 ? <tr><td className="px-4 py-6 text-gray-400">No open jobs.</td></tr> : aging.map(s => (
                <tr key={s.stage}>
                  <td className="px-4 py-2 text-gray-800">{s.label}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{s.count} job{s.count !== 1 ? 's' : ''}</td>
                  <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.avgAge != null ? `avg ${s.avgAge}d` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* A/R */}
        <Section title={`Open A/R — ${money(arTotal)}`} csv="ar">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {ar.length === 0 ? <tr><td className="px-4 py-6 text-gray-400">No open invoices.</td></tr> : ar.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2"><Link href={`/construction/invoices/${r.id}`} className="font-mono text-xs text-blue-600">{r.invoice_number}</Link></td>
                  <td className="px-4 py-2 text-gray-600 text-xs hidden sm:table-cell">{(r as any).con_customers?.name ?? ''}</td>
                  <td className="px-4 py-2 text-right text-xs">{r.daysOverdue > 0 ? <span className="text-red-600 font-medium">{r.daysOverdue}d overdue</span> : <span className="text-gray-400">due {fmtDate(r.due_date)}</span>}</td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-900">{money(r.invoice_grand_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, csv, children }: { title: string; csv: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <a href={`/api/construction/reports/csv?report=${csv}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800">
          <Download className="w-3.5 h-3.5" />CSV
        </a>
      </div>
      {children}
    </div>
  )
}

function MarginTable({ title, rows }: { title: string; rows: { name: string; quoted: number; invoiced: number; cost: number; margin: number }[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">{title}</h2></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500">
              <th className="text-left px-4 py-2 font-medium">{title.includes('Customer') ? 'Customer' : 'Program'}</th>
              <th className="text-right px-4 py-2 font-medium">Invoiced</th>
              <th className="text-right px-4 py-2 font-medium">Cost</th>
              <th className="text-right px-4 py-2 font-medium">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No data.</td></tr> : rows.map(r => (
              <tr key={r.name}>
                <td className="px-4 py-2 text-gray-800">{r.name}</td>
                <td className="px-4 py-2 text-right text-gray-600">{money(r.invoiced)}</td>
                <td className="px-4 py-2 text-right text-gray-500">{money(r.cost)}</td>
                <td className={`px-4 py-2 text-right font-semibold ${r.margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>{money(r.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
