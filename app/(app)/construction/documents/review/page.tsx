import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { ReviewRow } from '@/components/construction/review-row'
import { Inbox, ArrowLeft } from 'lucide-react'

// Company-wide triage queue for documents the importer (or an upload) couldn't
// confidently file. Pick a category and File to clear each one.
export default async function DocReviewPage() {
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()

  const { data: docs } = await admin
    .from('con_documents')
    .select('id, file_name, category, doc_type, source_path, job_id, con_jobs(site_number, con_customers(name))')
    .eq('company_id', company_id)
    .eq('review_status', 'needs_review')
    .order('created_at', { ascending: false })

  const rows = (docs ?? []).map(d => {
    const job = (d as any).con_jobs
    const jobLabel = job?.site_number
      ? `${job.site_number}${job?.con_customers?.name ? ' · ' + job.con_customers.name : ''}`
      : null
    return {
      id: d.id as string,
      file_name: d.file_name as string | null,
      category: d.category as string | null,
      doc_type: d.doc_type as string | null,
      source_path: d.source_path as string | null,
      jobLabel,
    }
  })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/construction" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> Construction
      </Link>

      <div className="mb-6">
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
          Document Review
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Files the importer wasn&apos;t sure about. Pick a category and File each one.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Needs Review ({rows.length})</h2>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <Inbox className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Nothing to review — everything&apos;s filed. 🎉</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {rows.map(doc => <ReviewRow key={doc.id} doc={doc} />)}
          </ul>
        )}
      </div>
    </div>
  )
}
