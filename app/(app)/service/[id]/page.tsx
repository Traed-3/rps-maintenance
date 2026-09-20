import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { WorkOrderStatusBadge, PriorityBadge, clientLabel } from '@/components/svc/work-order-badges'
import { createServiceTicket } from '@/app/(app)/service/tickets/actions'
import { createJobFromWorkOrder } from '@/app/(app)/construction/actions'
import { CON_ALLOWED_USER_IDS } from '@/lib/construction'

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
  const { data: existingTicket } = await admin.from('service_tickets').select('id, ticket_number, status').eq('work_order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()

  // Construction users can spin this dispatched WO up as a construction job (site + address auto-filled).
  const canConstruction = CON_ALLOWED_USER_IDS.includes(user?.id ?? '')
  const { data: existingJob } = canConstruction && (w as any).portal_wo_number
    ? await admin.from('con_jobs').select('id, job_number').eq('company_id', profile!.company_id).eq('work_order_number', (w as any).portal_wo_number).limit(1).maybeSingle()
    : { data: null }

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

      {(() => { const existing = (existingTicket as { id: string; ticket_number: string; status: string } | null); return existing ? (
        <Link href={`/service/tickets/${existing.id}`} className="block bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-900">Field ticket <b className="font-mono">{existing.ticket_number}</b> · {existing.status} →</Link>
      ) : (
        <form action={createServiceTicket} className="mb-5"><input type="hidden" name="work_order_id" value={w.id} /><button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium px-4 py-2 hover:bg-blue-700">Start field ticket</button></form>
      ) })()}

      {canConstruction && (
        existingJob ? (
          <Link href={`/construction/jobs/${existingJob.id}`} className="inline-block bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 mb-5 text-sm text-amber-900">Construction job <b className="font-mono">{existingJob.job_number ?? ''}</b> →</Link>
        ) : (
          <form action={createJobFromWorkOrder.bind(null, w.id)} className="mb-5"><button type="submit" className="rounded-lg border border-gray-300 bg-white text-gray-800 text-sm font-medium px-4 py-2 hover:bg-gray-50">Create construction job →</button></form>
        )
      )}

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
