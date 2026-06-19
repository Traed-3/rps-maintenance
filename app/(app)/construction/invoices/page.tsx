import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { money, fmtDate } from '@/lib/construction'
import { InvoiceStatusBadge } from '@/components/construction/badges'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  let query = admin
    .from('con_invoices')
    .select('id, invoice_number, invoice_date, due_date, status, invoice_grand_total, store_label, con_customers(name)')
    .eq('company_id', company_id)
    .order('invoice_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data: invoices } = await query

  const today = new Date().toISOString().split('T')[0]
  const STATUSES = ['', 'draft', 'sent', 'paid', 'overdue', 'void']

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
            Invoices
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{invoices?.length ?? 0} invoice{invoices?.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
          {canWrite && <Link href="/construction/invoices/new"><Button className="gap-2"><Plus className="w-4 h-4" />New Invoice</Button></Link>}
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-5">
        {STATUSES.map(s => (
          <Link key={s || 'all'} href={`/construction/invoices${s ? `?status=${s}` : ''}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border capitalize transition-colors ${status === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {s || 'All'}
          </Link>
        ))}
      </div>

      {!invoices?.length ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">No invoices yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Due</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Total</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map(inv => {
                  const isOverdue = inv.status === 'sent' && inv.due_date && inv.due_date < today
                  return (
                    <ClickableRow key={inv.id} href={`/construction/invoices/${inv.id}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-700 hidden sm:table-cell">{(inv as any).con_customers?.name ?? '—'}</td>
                      <td className="px-4 py-3"><InvoiceStatusBadge status={isOverdue ? 'overdue' : inv.status} /></td>
                      <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">{fmtDate(inv.invoice_date)}</td>
                      <td className={`px-4 py-3 text-xs hidden lg:table-cell ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{fmtDate(inv.due_date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{money(inv.invoice_grand_total)}</td>
                      <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">View →</span></td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
