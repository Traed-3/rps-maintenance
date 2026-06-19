import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { DocBuilder } from '@/components/construction/doc-builder'
import { saveQuote } from '../../actions'

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams
  const { company_id, canWrite } = await requireConstruction()
  if (!canWrite) redirect('/construction/quotes')
  const admin = createAdminClient()

  const [{ data: customers }, { data: jobs }, { data: jobRow }] = await Promise.all([
    admin.from('con_customers').select('id, name').eq('company_id', company_id).order('name'),
    admin.from('con_jobs').select('id, site_number, work_order_number').eq('company_id', company_id).order('created_at', { ascending: false }),
    job ? admin.from('con_jobs').select('id, customer_id, site_number, facility_address').eq('id', job).eq('company_id', company_id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href="/construction/quotes" className="text-sm text-gray-500 hover:text-gray-700">← Back to Quotes</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">New Quote</h1>
      </div>
      <DocBuilder
        mode="quote"
        action={saveQuote.bind(null, null)}
        customers={customers ?? []}
        jobs={jobs ?? []}
        header={jobRow ? {
          job_id: jobRow.id,
          customer_id: jobRow.customer_id,
          store_label: jobRow.site_number,
          facility_address: jobRow.facility_address,
        } : undefined}
      />
    </div>
  )
}
