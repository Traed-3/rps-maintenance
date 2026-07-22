import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { CON_STAGES, money, fmtDate, projectNotificationStatus } from '@/lib/construction'
import { InvoiceStatusBadge } from '@/components/construction/badges'
import { Users, HardHat, FileText, Receipt, Package, CalendarDays, BarChart3, ClipboardList, ListChecks, Hammer, Truck, Inbox } from 'lucide-react'

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default async function ConstructionDashboard() {
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()
  const today = new Date()
  const todayIso = iso(today)
  const monday = new Date(today); monday.setDate(today.getDate() + ((today.getDay() === 0 ? -6 : 1) - today.getDay()))
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)

  const [{ data: jobs }, { data: invoices }, { data: neededMaterials }, { data: schedule }] = await Promise.all([
    admin.from('con_jobs').select('id, site_number, stage, priority, project_start_date, notification_sent_at, notification_waived, con_customers(name)').eq('company_id', company_id),
    admin.from('con_invoices').select('id, invoice_number, status, invoice_grand_total, due_date, con_customers(name)').eq('company_id', company_id).in('status', ['draft', 'sent', 'overdue']),
    admin.from('con_job_materials').select('id').eq('company_id', company_id).in('status', ['needed', 'ordered']),
    admin.from('con_schedule_entries').select('*').eq('company_id', company_id).gte('schedule_date', iso(monday)).lte('schedule_date', iso(sunday)).order('schedule_date'),
  ])

  const allJobs = jobs ?? []
  const notifyDue = allJobs
    .map(j => ({ job: j, n: projectNotificationStatus(j) }))
    .filter(x => x.n.isDue)
    .sort((a, b) => (a.n.daysToDeadline ?? 0) - (b.n.daysToDeadline ?? 0))
  const stageCounts = CON_STAGES.map(s => ({ ...s, count: allJobs.filter(j => j.stage === s.value).length }))
  const needingInvoice = allJobs.filter(j => j.stage === 'invoicing')
  const waitingMaterial = allJobs.filter(j => j.stage === 'material_ordering')

  const arRows = (invoices ?? []).map(inv => {
    const overdue = inv.status === 'sent' && inv.due_date && inv.due_date < todayIso
    return { ...inv, effectiveStatus: overdue ? 'overdue' : inv.status }
  })
  const arOpen = arRows.reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)
  const arOverdue = arRows.filter(r => r.effectiveStatus === 'overdue').reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)

  const { count: reviewCount } = await admin.from('con_documents')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company_id).eq('review_status', 'needs_review')

  const tiles = [
    { href: '/construction/jobs', label: 'Jobs', icon: HardHat, value: allJobs.length },
    { href: '/construction/quotes', label: 'Quotes', icon: FileText },
    { href: '/construction/invoices', label: 'Invoices', icon: Receipt, value: money(arOpen), sub: 'open A/R' },
    { href: '/construction/materials', label: 'Materials', icon: Package, value: neededMaterials?.length ?? 0, sub: 'to order/receive' },
    { href: '/construction/vendors', label: 'Vendors', icon: Truck },
    { href: '/construction/subcontractors', label: 'Subcontractors', icon: Hammer },
    { href: '/construction/schedule', label: 'Schedule', icon: CalendarDays },
    { href: '/construction/trackers', label: 'Sunoco Trackers', icon: ClipboardList },
    { href: '/construction/checklist', label: 'Checklist', icon: ListChecks },
    { href: '/construction/customers', label: 'Customers', icon: Users },
    { href: '/construction/documents/review', label: 'Doc Review', icon: Inbox, value: reviewCount ?? 0, sub: 'to review' },
    { href: '/construction/reports', label: 'Reports', icon: BarChart3 },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
          Construction
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Job pipeline, quotes, invoices & scheduling</p>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {tiles.map(t => (
          <Link key={t.href} href={t.href} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 hover:shadow transition-all">
            <t.icon className="w-5 h-5 text-blue-600 mb-2" />
            <p className="text-sm font-semibold text-gray-900 break-words leading-tight">{t.label}</p>
            {t.value != null && <p className="text-xs text-gray-500 mt-0.5">{t.value}{t.sub ? ` ${t.sub}` : ''}</p>}
          </Link>
        ))}
      </div>

      {/* Project notifications due */}
      {notifyDue.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-300 shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <h2 className="font-semibold text-amber-900 text-sm">⚠ Project Notifications to send</h2>
            <span className="text-xs font-semibold text-amber-800">{notifyDue.length}</span>
          </div>
          <ul className="divide-y divide-gray-50">
            {notifyDue.map(({ job, n }) => (
              <li key={job.id}>
                <Link href={`/construction/jobs/${job.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-gray-50">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">{job.site_number ?? '—'}</span>
                    {(job as any).con_customers?.name && <span className="text-xs text-gray-400 ml-2">{(job as any).con_customers.name}</span>}
                    <div className="text-xs text-gray-400">Starts {fmtDate(job.project_start_date)} · send by {fmtDate(n.deadline)}</div>
                  </div>
                  <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${n.className}`}>{n.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pipeline counts */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <h2 className="font-semibold text-gray-900 mb-3">Pipeline by Stage</h2>
        <div className="flex flex-wrap gap-2">
          {stageCounts.map(s => (
            <Link key={s.value} href={`/construction/jobs?view=table&stage=${s.value}`}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${s.className} hover:opacity-80`}>
              {s.label}<span className="bg-white/60 rounded-full px-1.5">{s.count}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Needs invoice */}
        <Panel title="Ready to Invoice" count={needingInvoice.length} href="/construction/jobs?view=table&stage=invoicing">
          {needingInvoice.length === 0 ? <Empty>No jobs awaiting invoicing.</Empty> : needingInvoice.slice(0, 6).map(j => (
            <Row key={j.id} href={`/construction/jobs/${j.id}`} left={j.site_number ?? '—'} right={(j as any).con_customers?.name ?? ''} />
          ))}
        </Panel>

        {/* Waiting material */}
        <Panel title="Waiting on Material" count={waitingMaterial.length} href="/construction/jobs?view=table&stage=material_ordering">
          {waitingMaterial.length === 0 ? <Empty>Nothing waiting on material.</Empty> : waitingMaterial.slice(0, 6).map(j => (
            <Row key={j.id} href={`/construction/jobs/${j.id}`} left={j.site_number ?? '—'} right={(j as any).con_customers?.name ?? ''} />
          ))}
        </Panel>

        {/* A/R */}
        <Panel title="Open Invoices (A/R)" count={arRows.length} href="/construction/invoices">
          {arRows.length === 0 ? <Empty>No open invoices.</Empty> : (
            <>
              {arOverdue > 0 && <p className="px-4 py-1.5 text-xs text-red-600 font-medium">{money(arOverdue)} overdue</p>}
              {arRows.slice(0, 6).map(r => (
                <Link key={r.id} href={`/construction/invoices/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-gray-50">
                  <span className="font-mono text-xs text-gray-700">{r.invoice_number}</span>
                  <InvoiceStatusBadge status={r.effectiveStatus} />
                  <span className="text-sm font-semibold text-gray-900 w-24 text-right">{money(r.invoice_grand_total)}</span>
                </Link>
              ))}
            </>
          )}
        </Panel>
      </div>

      {/* This week's schedule */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mt-6">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">This Week&apos;s Schedule</h2>
          <Link href="/construction/schedule" className="text-xs font-medium text-blue-600 hover:text-blue-800">Open schedule →</Link>
        </div>
        {!schedule?.length ? <Empty>Nothing scheduled this week.</Empty> : (
          <ul className="divide-y divide-gray-50">
            {schedule.map(e => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-16 text-xs text-gray-500">{fmtDate(e.schedule_date)}</span>
                <span className="flex-1 text-gray-900">{e.site_number ?? e.task_description ?? '—'}</span>
                {e.crew?.length ? <span className="text-xs text-gray-500">{e.crew.join(', ')}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Panel({ title, count, href, children }: { title: string; count: number; href: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <Link href={href} className="text-xs text-gray-400 hover:text-gray-600">{count}</Link>
      </div>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  )
}
function Row({ href, left, right }: { href: string; left: string; right: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-gray-50">
      <span className="font-medium text-gray-900 text-sm">{left}</span>
      <span className="text-xs text-gray-500 truncate">{right}</span>
    </Link>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-gray-400">{children}</p>
}
