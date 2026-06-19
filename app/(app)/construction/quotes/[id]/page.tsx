import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { pctFromDecimal, QUOTE_STATUSES } from '@/lib/construction'
import { DocBuilder, type LineRowState } from '@/components/construction/doc-builder'
import { StatusButtons } from '@/components/construction/status-buttons'
import { DeleteButton } from '@/components/construction/delete-button'
import { Button } from '@/components/ui/button'
import { FileDown, FileText } from 'lucide-react'
import { saveQuote, setQuoteStatus, deleteQuote, convertQuoteToInvoice } from '../../actions'

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: quote } = await admin.from('con_quotes').select('*').eq('id', id).eq('company_id', company_id).single()
  if (!quote) notFound()

  const [{ data: items }, { data: customers }, { data: jobs }] = await Promise.all([
    admin.from('con_quote_line_items').select('*').eq('quote_id', id).order('section').order('line_no'),
    admin.from('con_customers').select('id, name').eq('company_id', company_id).order('name'),
    admin.from('con_jobs').select('id, site_number, work_order_number').eq('company_id', company_id).order('created_at', { ascending: false }),
  ])

  const initialLines: LineRowState[] = (items ?? []).map((it, i) => ({
    key: `r${i}`,
    section: it.section === 'additional' ? 'additional' : 'basic',
    description: it.description ?? '',
    quantity: it.quantity != null ? String(it.quantity) : '',
    unit_cost: it.unit_cost != null ? String(it.unit_cost) : '',
    labor_hours: it.labor_hours != null ? String(it.labor_hours) : '',
    labor_rate: it.labor_rate != null ? String(it.labor_rate) : '',
    item_type: it.item_type ?? 'material',
    is_stock: !!it.is_stock,
  }))

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <Link href="/construction/quotes" className="text-sm text-gray-500 hover:text-gray-700">← Back to Quotes</Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{quote.quote_number}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/construction/quotes/${id}/pdf`} target="_blank" rel="noopener">
              <Button variant="outline" className="gap-2"><FileDown className="w-3.5 h-3.5" />PDF</Button>
            </a>
            {quote.job_id && (
              <Link href={`/construction/jobs/${quote.job_id}`}>
                <Button variant="outline" className="gap-2"><FileText className="w-3.5 h-3.5" />Job</Button>
              </Link>
            )}
            {canWrite && (
              <form action={convertQuoteToInvoice.bind(null, id)}>
                <Button type="submit" variant="outline">Convert to Invoice →</Button>
              </form>
            )}
          </div>
        </div>
        {canWrite && (
          <div className="mt-3">
            <StatusButtons id={id} current={quote.status} options={QUOTE_STATUSES} action={setQuoteStatus} />
          </div>
        )}
      </div>

      {canWrite ? (
        <DocBuilder
          mode="quote"
          action={saveQuote.bind(null, id)}
          customers={customers ?? []}
          jobs={jobs ?? []}
          initialLines={initialLines}
          header={{
            id: quote.id,
            job_id: quote.job_id,
            customer_id: quote.customer_id,
            attn: quote.attn,
            customer_email: quote.customer_email,
            store_label: quote.store_label,
            facility_address: quote.facility_address,
            city_state_zip: quote.city_state_zip,
            project_description: quote.project_description,
            profit_overhead_percent: pctFromDecimal(quote.profit_overhead_percent),
            sales_tax_percent: pctFromDecimal(quote.sales_tax_percent),
            status: quote.status,
            prepared_by: quote.prepared_by,
            proposal_date: quote.proposal_date,
            sent_date: quote.sent_date,
            decision_date: quote.decision_date,
          }}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-sm text-gray-600">
          <p>This quote is read-only for your role. Use the PDF button to view the full proposal.</p>
        </div>
      )}

      {canWrite && (
        <div className="mt-4 flex justify-end">
          <DeleteButton action={deleteQuote.bind(null, id)} confirm="Delete this quote and its line items?" label="Delete Quote" />
        </div>
      )}
    </div>
  )
}
