import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { loadBuilderLists } from '@/lib/billing-data'
import { Rev19Builder } from '@/components/billing/rev19-builder'
import { saveQuote } from '../../actions'

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ job?: string; department?: string; customer?: string }> }) {
  const { job, department, customer } = await searchParams
  const { id: userId, company_id, canWrite } = await requireBilling()
  if (!canWrite) redirect('/billing/quotes')
  const admin = createAdminClient()
  const lists = await loadBuilderLists(admin, company_id)
  let header: Record<string, unknown> = { kind: 'quote', job_id: job ?? null, department: department ?? 'construction', customer_id: customer ?? null }
  if (job) {
    const { data: j } = await admin.from('con_jobs').select('customer_id, site_number, work_order_number, facility_address, scope_of_work').eq('id', job).eq('company_id', company_id).maybeSingle()
    if (j) header = { ...header, customer_id: j.customer_id, site_number: j.site_number, work_order_number: j.work_order_number, facility_address: j.facility_address, project_description: j.scope_of_work }
  }
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5"><Link href="/billing/quotes" className="text-sm text-gray-500 hover:text-gray-700">← Quotes</Link><h1 className="text-2xl font-bold text-gray-900 mt-1">New starting quote</h1><p className="text-sm text-gray-500">Twelve REV19 categories. Quantities and costs come from the catalog with their source and date; the face and breakdown print from what you enter here.</p></div>
      <Rev19Builder action={saveQuote.bind(null, null)} header={header as never} customers={lists.customers} jobs={lists.jobs} rateCards={lists.rateCards} team={lists.team} quickPicks={lists.quickPicks} currentUser={lists.team.find(t => t.id === userId) ?? null} />
    </div>
  )
}
