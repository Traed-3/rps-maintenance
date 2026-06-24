import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { money, fmtDate, projectNotificationStatus } from '@/lib/construction'
import { NotificationCard } from '@/components/construction/notification-card'
import { ConPriorityBadge, QuoteStatusBadge, InvoiceStatusBadge, MaterialStatusBadge } from '@/components/construction/badges'
import { StageSelect } from '@/components/construction/stage-select'
import { MaterialForm } from '@/components/construction/material-form'
import { MaterialStatusSelect } from '@/components/construction/material-status-select'
import { ScheduleEntryForm } from '@/components/construction/schedule-entry-form'
import { CloseoutChecklist } from '@/components/construction/closeout-checklist'
import { JobLaborForm } from '@/components/construction/job-labor-form'
import { DocumentUpload } from '@/components/construction/document-upload'
import { DeleteButton } from '@/components/construction/delete-button'
import { AssignSubcontractor } from '@/components/construction/assign-subcontractor'
import { Button } from '@/components/ui/button'
import { Pencil, Plus, FileText } from 'lucide-react'
import {
  changeJobStage, saveMaterial, setMaterialStatus, deleteMaterial,
  saveScheduleEntry, deleteScheduleEntry,
  toggleCloseoutTask, deleteCloseoutTask, addCloseoutTask, seedCloseoutTasks,
  addJobLabor, deleteJobLabor, deleteDocument,
  assignSubcontractor, unassignSubcontractor,
} from '../../actions'

const TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'quote',     label: 'Quotes' },
  { key: 'invoice',   label: 'Invoices' },
  { key: 'materials', label: 'Materials' },
  { key: 'schedule',  label: 'Schedule' },
  { key: 'subs',      label: 'Subcontractors' },
  { key: 'closeout',  label: 'Close-Out' },
  { key: 'documents', label: 'Documents' },
  { key: 'cost',      label: 'Cost Summary' },
]

export default async function JobDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab = 'overview' } = await searchParams
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: job } = await admin
    .from('con_jobs')
    .select('*, con_customers(id, name), profiles!con_jobs_assigned_manager_id_fkey(full_name)')
    .eq('id', id).eq('company_id', company_id).single()
  if (!job) notFound()

  // Per-tab data (and always what the Cost Summary needs)
  const [
    { data: quotes }, { data: invoices }, { data: materials },
    { data: schedule }, { data: closeout }, { data: labor }, { data: documents },
    { data: assignedSubs }, { data: allSubs }, { data: vendorRows },
  ] = await Promise.all([
    admin.from('con_quotes').select('id, quote_number, proposal_date, status, final_total').eq('job_id', id).order('created_at', { ascending: false }),
    admin.from('con_invoices').select('id, invoice_number, invoice_date, status, invoice_grand_total, due_date').eq('job_id', id).order('created_at', { ascending: false }),
    admin.from('con_job_materials').select('*').eq('job_id', id).order('created_at'),
    admin.from('con_schedule_entries').select('*').eq('job_id', id).order('schedule_date', { ascending: false }),
    admin.from('con_closeout_tasks').select('*').eq('job_id', id).order('created_at'),
    admin.from('con_job_labor').select('*').eq('job_id', id).order('work_date', { ascending: false }),
    admin.from('con_documents').select('*').eq('job_id', id).order('created_at', { ascending: false }),
    admin.from('con_job_subcontractors').select('id, role, con_subcontractors(id, name, trade, phone)').eq('job_id', id),
    admin.from('con_subcontractors').select('id, name, trade').eq('company_id', company_id).eq('is_active', true).order('name'),
    admin.from('con_vendors').select('name').eq('company_id', company_id).eq('is_active', true).order('name'),
  ])

  const customerName = (job as any).con_customers?.name
  const managerName = (job as any).profiles?.full_name
  const vendorNames = (vendorRows ?? []).map(v => v.name).filter(Boolean)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <Link href="/construction/jobs" className="text-sm text-gray-500 hover:text-gray-700">← Back to Jobs</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{job.site_number ?? 'Job'}</h1>
              <ConPriorityBadge priority={job.priority} />
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {customerName && <span>{customerName}</span>}
              {job.work_order_number && <span className="ml-2 font-mono text-gray-400">{job.work_order_number}</span>}
              {job.gas_brand && <span className="ml-2">· {job.gas_brand}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canWrite ? <StageSelect jobId={job.id} stage={job.stage} action={changeJobStage} /> : null}
            {canWrite && (
              <Link href={`/construction/jobs/${id}/edit`}>
                <Button variant="outline" className="gap-2"><Pencil className="w-3.5 h-3.5" />Edit</Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap border-b border-gray-200 mb-5">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/construction/jobs/${id}?tab=${t.key}`}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── OVERVIEW ───────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
            {job.scope_of_work && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Scope of Work</h3>
                <p className="text-sm text-gray-800 whitespace-pre-line">{job.scope_of_work}</p>
              </div>
            )}
            {job.status_detail && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Current Status</h3>
                <p className="text-sm text-gray-800">{job.status_detail}</p>
              </div>
            )}
            {job.notes && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</h3>
                <p className="text-sm text-gray-800 whitespace-pre-line">{job.notes}</p>
              </div>
            )}
            {!job.scope_of_work && !job.status_detail && !job.notes && (
              <p className="text-sm text-gray-400">No scope or notes recorded yet.</p>
            )}
          </div>
          <div className="space-y-5">
            <NotificationCard jobId={job.id} status={projectNotificationStatus(job)} canWrite={canWrite} />
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3 text-sm">
              <Detail label="Program" value={job.program} />
              <Detail label="Facility Address" value={job.facility_address} />
              <Detail label="Manager" value={managerName} />
              <Detail label="Response Time" value={job.response_time} />
              <Detail label="Date Received" value={fmtDate(job.date_received)} />
              <Detail label="Project Start" value={fmtDate(job.project_start_date)} />
            </div>
          </div>
        </div>
      )}

      {/* ── QUOTES ─────────────────────────────────────────── */}
      {tab === 'quote' && (
        <DocList
          title="Quotes"
          newHref={`/construction/quotes/new?job=${id}`}
          canWrite={canWrite}
          empty="No quotes for this job yet."
          rows={(quotes ?? []).map(q => ({
            id: q.id, href: `/construction/quotes/${q.id}`,
            left: q.quote_number ?? 'Draft', sub: fmtDate(q.proposal_date),
            badge: <QuoteStatusBadge status={q.status} />, amount: money(q.final_total),
          }))}
        />
      )}

      {/* ── INVOICES ───────────────────────────────────────── */}
      {tab === 'invoice' && (
        <DocList
          title="Invoices"
          newHref={`/construction/invoices/new?job=${id}`}
          canWrite={canWrite}
          empty="No invoices for this job yet."
          rows={(invoices ?? []).map(inv => ({
            id: inv.id, href: `/construction/invoices/${inv.id}`,
            left: inv.invoice_number ?? 'Draft', sub: fmtDate(inv.invoice_date),
            badge: <InvoiceStatusBadge status={inv.status} />, amount: money(inv.invoice_grand_total),
          }))}
        />
      )}

      {/* ── MATERIALS ──────────────────────────────────────── */}
      {tab === 'materials' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Materials ({materials?.length ?? 0})</h2></div>
            {!materials?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400">No materials listed.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {materials.map(m => (
                    <tr key={m.id}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{m.description}</span>
                        <div className="text-xs text-gray-400">
                          {[m.part_number && `PN ${m.part_number}`, m.quantity != null && `Qty ${m.quantity}`, m.unit_cost != null && money(m.unit_cost), m.vendor].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {canWrite ? <MaterialStatusSelect id={m.id} status={m.status} action={setMaterialStatus} /> : <MaterialStatusBadge status={m.status} />}
                      </td>
                      {canWrite && <td className="px-4 py-3 text-right"><DeleteButton action={deleteMaterial.bind(null, m.id)} confirm="Remove this material?" iconOnly /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {canWrite && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Add Material</h3>
              <MaterialForm action={saveMaterial.bind(null, null)} jobId={id} vendors={vendorNames} />
            </div>
          )}
        </div>
      )}

      {/* ── SCHEDULE ───────────────────────────────────────── */}
      {tab === 'schedule' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Scheduled Work</h2></div>
            {!schedule?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400">Not scheduled yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {schedule.map(s => (
                    <tr key={s.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">{fmtDate(s.schedule_date)}</td>
                      <td className="px-4 py-3">
                        <span className="text-gray-900">{s.task_description ?? '—'}</span>
                        <div className="text-xs text-gray-400">{[s.crew?.join(', '), s.equipment].filter(Boolean).join(' · ')}</div>
                      </td>
                      {canWrite && <td className="px-4 py-3 text-right"><DeleteButton action={deleteScheduleEntry.bind(null, s.id)} confirm="Remove this schedule entry?" iconOnly /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {canWrite && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Add to Schedule</h3>
              <ScheduleEntryForm action={saveScheduleEntry.bind(null, null)} jobs={[]} fixedJobId={id} />
            </div>
          )}
        </div>
      )}

      {/* ── SUBCONTRACTORS ─────────────────────────────────── */}
      {tab === 'subs' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Assigned Subcontractors ({assignedSubs?.length ?? 0})</h2></div>
            {!assignedSubs?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400">No subcontractors assigned to this project.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {assignedSubs.map(a => {
                    const sc = (a as any).con_subcontractors
                    return (
                      <tr key={a.id}>
                        <td className="px-4 py-3">
                          {sc ? (
                            <Link href={`/construction/subcontractors/${sc.id}`} className="font-medium text-blue-600 hover:underline">{sc.name}</Link>
                          ) : <span className="text-gray-400">—</span>}
                          <div className="text-xs text-gray-400">{[sc?.trade, a.role, sc?.phone].filter(Boolean).join(' · ')}</div>
                        </td>
                        {canWrite && <td className="px-4 py-3 text-right"><DeleteButton action={unassignSubcontractor.bind(null, a.id)} confirm="Remove this subcontractor from the project?" iconOnly /></td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          {canWrite && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Assign a Subcontractor</h3>
              {allSubs?.length ? (
                <AssignSubcontractor action={assignSubcontractor.bind(null, id)} subs={allSubs} />
              ) : (
                <p className="text-sm text-gray-400">No subcontractors yet. <Link href="/construction/subcontractors" className="text-blue-600 hover:underline">Add one first.</Link></p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── CLOSE-OUT ──────────────────────────────────────── */}
      {tab === 'closeout' && (
        <CloseoutChecklist
          tasks={closeout ?? []}
          canWrite={canWrite}
          onToggle={toggleCloseoutTask}
          onDelete={deleteCloseoutTask}
          onAdd={addCloseoutTask.bind(null, id)}
          onSeed={seedCloseoutTasks.bind(null, id)}
        />
      )}

      {/* ── DOCUMENTS ──────────────────────────────────────── */}
      {tab === 'documents' && (
        <div className="space-y-5">
          {canWrite && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Upload Document</h3>
              <DocumentUpload jobId={id} />
            </div>
          )}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Documents ({documents?.length ?? 0})</h2></div>
            {!documents?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400">No documents uploaded.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {documents.map(d => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                    <a href={`/api/construction/documents/${d.id}`} target="_blank" rel="noopener" className="flex-1 text-sm font-medium text-blue-600 hover:text-blue-800 truncate">{d.file_name}</a>
                    {d.doc_type && <span className="text-xs text-gray-400 capitalize">{d.doc_type.replace(/_/g, ' ')}</span>}
                    {canWrite && <DeleteButton action={deleteDocument.bind(null, d.id)} confirm="Delete this document?" iconOnly />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── COST SUMMARY ───────────────────────────────────── */}
      {tab === 'cost' && (
        <CostSummary jobId={id} companyId={company_id} canWrite={canWrite} labor={labor ?? []} />
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-800 text-right">{value || '—'}</span>
    </div>
  )
}

type DocRow = { id: string; href: string; left: string; sub: string; badge: React.ReactNode; amount: string }
function DocList({ title, newHref, canWrite, empty, rows }: { title: string; newHref: string; canWrite: boolean; empty: string; rows: DocRow[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {canWrite && <Link href={newHref}><Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" />New</Button></Link>}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {rows.map(r => (
            <li key={r.id}>
              <Link href={r.href} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <div className="flex-1">
                  <span className="font-medium text-gray-900 font-mono text-sm">{r.left}</span>
                  <div className="text-xs text-gray-400">{r.sub}</div>
                </div>
                {r.badge}
                <span className="font-semibold text-gray-900 w-28 text-right">{r.amount}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function CostSummary({ jobId, companyId, canWrite, labor }: { jobId: string; companyId: string; canWrite: boolean; labor: any[] }) {
  const admin = createAdminClient()
  const [{ data: quotes }, { data: invoices }, { data: materials }] = await Promise.all([
    admin.from('con_quotes').select('final_total, status').eq('job_id', jobId).eq('company_id', companyId),
    admin.from('con_invoices').select('id, invoice_grand_total').eq('job_id', jobId).eq('company_id', companyId),
    admin.from('con_job_materials').select('quantity, unit_cost, status').eq('job_id', jobId).eq('company_id', companyId),
  ])

  const invoiceIds = (invoices ?? []).map(i => i.id)
  let invoiceLaborCost = 0
  if (invoiceIds.length) {
    const { data: liLabor } = await admin.from('con_invoice_line_items').select('total_labor').in('invoice_id', invoiceIds)
    invoiceLaborCost = (liLabor ?? []).reduce((a, l) => a + (Number(l.total_labor) || 0), 0)
  }

  const quotedTotal = (quotes ?? []).reduce((a, q) => a + (Number(q.final_total) || 0), 0)
  const invoicedTotal = (invoices ?? []).reduce((a, i) => a + (Number(i.invoice_grand_total) || 0), 0)
  const materialCost = (materials ?? [])
    .filter(m => ['ordered', 'received', 'in_stock'].includes(m.status))
    .reduce((a, m) => a + (Number(m.quantity) || 0) * (Number(m.unit_cost) || 0), 0)
  const manualLaborCost = (labor ?? []).reduce((a, l) => a + (Number(l.hours) || 0) * (Number(l.labor_rate) || 0), 0)
  const laborCost = invoiceLaborCost + manualLaborCost
  const margin = invoicedTotal - (materialCost + laborCost)
  const marginPct = invoicedTotal > 0 ? (margin / invoicedTotal) * 100 : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Quoted" value={money(quotedTotal)} />
        <Stat label="Invoiced" value={money(invoicedTotal)} />
        <Stat label="Material Cost" value={money(materialCost)} />
        <Stat label="Labor Cost" value={money(laborCost)} />
        <Stat label="Margin" value={money(margin)} accent={margin >= 0 ? 'text-green-700' : 'text-red-700'} sub={marginPct != null ? `${marginPct.toFixed(1)}%` : undefined} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Manual Labor Log</h2></div>
        {!labor?.length ? (
          <p className="px-4 py-6 text-sm text-gray-400">No manual labor logged. (Invoice labor is included in the totals above.)</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {labor.map(l => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(l.work_date)}</td>
                  <td className="px-4 py-2.5 text-gray-900">{l.crew_member ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{l.hours} hr{l.labor_rate ? ` @ ${money(l.labor_rate)}` : ''}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{l.task_note ?? ''}</td>
                  {canWrite && <td className="px-4 py-2.5 text-right"><DeleteButton action={deleteJobLabor.bind(null, l.id)} confirm="Remove this labor entry?" iconOnly /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canWrite && (
          <div className="px-4 py-4 border-t border-gray-100 bg-gray-50">
            <JobLaborForm action={addJobLabor.bind(null, jobId)} />
          </div>
        )}
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
