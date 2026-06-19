import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { pctFromDecimal, INVOICE_STATUSES } from '@/lib/construction'
import { DocBuilder, type LineRowState } from '@/components/construction/doc-builder'
import { StatusButtons } from '@/components/construction/status-buttons'
import { DeleteButton } from '@/components/construction/delete-button'
import { Button } from '@/components/ui/button'
import { FileDown, FileText } from 'lucide-react'
import { saveInvoice, setInvoiceStatus, deleteInvoice } from '../../actions'

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: invoice } = await admin.from('con_invoices').select('*').eq('id', id).eq('company_id', company_id).single()
  if (!invoice) notFound()

  const [{ data: items }, { data: customers }, { data: jobs }] = await Promise.all([
    admin.from('con_invoice_line_items').select('*').eq('invoice_id', id).order('section').order('line_no'),
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
        <Link href="/construction/invoices" className="text-sm text-gray-500 hover:text-gray-700">← Back to Invoices</Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{invoice.invoice_number}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/construction/invoices/${id}/pdf`} target="_blank" rel="noopener">
              <Button variant="outline" className="gap-2"><FileDown className="w-3.5 h-3.5" />PDF</Button>
            </a>
            {invoice.job_id && (
              <Link href={`/construction/jobs/${invoice.job_id}`}>
                <Button variant="outline" className="gap-2"><FileText className="w-3.5 h-3.5" />Job</Button>
              </Link>
            )}
          </div>
        </div>
        {canWrite && (
          <div className="mt-3">
            <StatusButtons id={id} current={invoice.status} options={INVOICE_STATUSES} action={setInvoiceStatus} />
          </div>
        )}
      </div>

      {canWrite ? (
        <DocBuilder
          mode="invoice"
          action={saveInvoice.bind(null, id)}
          customers={customers ?? []}
          jobs={jobs ?? []}
          initialLines={initialLines}
          header={{
            id: invoice.id,
            job_id: invoice.job_id,
            quote_id: invoice.quote_id,
            customer_id: invoice.customer_id,
            attn: invoice.attn,
            store_label: invoice.store_label,
            facility_address: invoice.facility_address,
            city_state_zip: invoice.city_state_zip,
            project_description: invoice.project_description,
            profit_overhead_percent: pctFromDecimal(invoice.profit_overhead_percent),
            sales_tax_percent: pctFromDecimal(invoice.sales_tax_percent),
            status: invoice.status,
            prepared_by: invoice.prepared_by,
            invoice_date: invoice.invoice_date,
            csr_number: invoice.csr_number,
            po_number: invoice.po_number,
            due_date: invoice.due_date,
            paid_date: invoice.paid_date,
          }}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-sm text-gray-600">
          <p>This invoice is read-only for your role. Use the PDF button to view it.</p>
        </div>
      )}

      {canWrite && (
        <div className="mt-4 flex justify-end">
          <DeleteButton action={deleteInvoice.bind(null, id)} confirm="Delete this invoice and its line items?" label="Delete Invoice" />
        </div>
      )}
    </div>
  )
}
