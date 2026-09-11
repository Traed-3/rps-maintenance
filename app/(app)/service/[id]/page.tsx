import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { WorkOrderStatusBadge, PriorityBadge, clientLabel } from '@/components/svc/work-order-badges'

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id').eq('id', user!.id).single()

  const { data: w } = await admin
    .from('svc_work_orders')
    .select(`*, svc_technicians(full_name, personal_email)`)
    .eq('id', id)
    .eq('company_id', profile!.company_id)
    .single()

  if (!w) notFound()

  const tech = (w as any).svc_technicians as { full_name: string; personal_email: string | null } | null

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/service" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Service Dispatch
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight font-mono">{w.portal_wo_number}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {clientLabel(w.source_portal, w.client_name)}
            {w.incident_number && <> · Incident {w.incident_number}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <WorkOrderStatusBadge status={w.status} />
          <PriorityBadge priorityRaw={w.priority_raw} priorityRank={w.priority_rank} />
        </div>
      </div>

      {w.return_trip_needed && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-red-800">⟲ Return Trip Needed</p>
          {w.return_trip_reason && <p className="text-sm text-red-700 mt-1">{w.return_trip_reason}</p>}
        </div>
      )}

      {w.invoice_rejected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-amber-800">Invoice Rejected</p>
          {w.invoice_rejection_reason && <p className="text-sm text-amber-700 mt-1">{w.invoice_rejection_reason}</p>}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Site</h2>
          <dl className="space-y-1.5 text-sm">
            <div><dt className="inline text-gray-400">Number:</dt> <dd className="inline text-gray-900">{w.site_number ?? '—'}</dd></div>
            <div><dt className="inline text-gray-400">Name:</dt> <dd className="inline text-gray-900">{w.site_name ?? '—'}</dd></div>
            <div><dt className="inline text-gray-400">Address:</dt> <dd className="inline text-gray-900">{w.site_address ?? '—'}</dd></div>
            <div><dt className="inline text-gray-400">City/State:</dt> <dd className="inline text-gray-900">{[w.site_city, w.site_state].filter(Boolean).join(', ') || '—'}</dd></div>
          </dl>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Timeline</h2>
          <dl className="space-y-1.5 text-sm">
            <div><dt className="inline text-gray-400">Dispatched:</dt> <dd className="inline text-gray-900">{fmt(w.dispatched_at)}</dd></div>
            <div><dt className="inline text-gray-400">Last Update:</dt> <dd className="inline text-gray-900">{fmt(w.last_update_at)}</dd></div>
            {w.sla_due_at && <div><dt className="inline text-gray-400">SLA Due:</dt> <dd className="inline text-gray-900">{fmt(w.sla_due_at)}</dd></div>}
            {w.completed_at && <div><dt className="inline text-gray-400">Completed:</dt> <dd className="inline text-gray-900">{fmt(w.completed_at)}</dd></div>}
          </dl>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-5">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Assigned Technician</h2>
        {tech ? (
          <p className="text-sm text-gray-900">{tech.full_name} {tech.personal_email && <span className="text-gray-400">· {tech.personal_email}</span>}</p>
        ) : (
          <p className="text-sm text-gray-400">No technician matched yet — the confirmation email's sender didn't match anyone in the roster.</p>
        )}
      </div>

      {w.completion_note_raw && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Tech's Completion Note</h2>
          <p className="text-sm text-gray-900 whitespace-pre-wrap">{w.completion_note_raw}</p>
        </div>
      )}

      {w.subject_raw && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Original Dispatch Subject</h2>
          <p className="text-sm text-gray-600">{w.subject_raw}</p>
        </div>
      )}
    </div>
  )
}
