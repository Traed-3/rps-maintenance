import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { money } from '@/lib/construction'
import { Button } from '@/components/ui/button'
import { FileText, ReceiptText, Plus } from 'lucide-react'

/**
 * Billing hub — the top-level home for Quotes and Invoices across BOTH
 * departments (Construction and Service). The engine (lib/billing.ts) and the
 * lists are already department-agnostic; this page just gives billing its own
 * front door instead of it living only under Construction.
 */
export default async function BillingPage() {
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const [{ data: quotes }, { data: invoices }] = await Promise.all([
    admin.from('con_quotes').select('department, status, final_total').eq('company_id', company_id),
    admin.from('con_invoices').select('department, status, invoice_grand_total').eq('company_id', company_id),
  ])

  const q = quotes ?? []
  const inv = invoices ?? []
  const byDept = (rows: { department?: string | null }[], dept: string) =>
    rows.filter(r => (r.department ?? 'construction') === dept).length
  const openQuotes = q.filter(r => r.status === 'draft' || r.status === 'sent').length
  const invoicedTotal = inv.reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
          Billing
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Quotes and invoices for Construction and Service — one place.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Quotes card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-semibold text-gray-900"><FileText className="w-4 h-4 text-blue-600" />Quotes</h2>
            <span className="text-xs text-gray-400">{q.length} total</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-3">{openQuotes}<span className="text-sm font-normal text-gray-400"> open</span></p>
          <p className="text-xs text-gray-500 mt-1">{byDept(q, 'construction')} construction · {byDept(q, 'service')} service</p>
          <div className="flex items-center gap-2 mt-4">
            <Link href="/construction/quotes"><Button variant="outline" size="sm">View all →</Button></Link>
            {canWrite && <Link href="/construction/quotes/new"><Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" />New quote</Button></Link>}
          </div>
        </div>

        {/* Invoices card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-semibold text-gray-900"><ReceiptText className="w-4 h-4 text-green-600" />Invoices</h2>
            <span className="text-xs text-gray-400">{inv.length} total</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-3">{money(invoicedTotal)}</p>
          <p className="text-xs text-gray-500 mt-1">{byDept(inv, 'construction')} construction · {byDept(inv, 'service')} service</p>
          <div className="flex items-center gap-2 mt-4">
            <Link href="/construction/invoices"><Button variant="outline" size="sm">View all →</Button></Link>
            {canWrite && <Link href="/construction/invoices/new"><Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" />New invoice</Button></Link>}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-6">Service field tickets convert straight into service invoices and appear here too.</p>
    </div>
  )
}
