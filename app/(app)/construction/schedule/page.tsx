import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { ScheduleEntryForm } from '@/components/construction/schedule-entry-form'
import { ScheduleMove } from '@/components/construction/schedule-move'
import { DeleteButton } from '@/components/construction/delete-button'
import { saveScheduleEntry, moveScheduleEntry, deleteScheduleEntry } from '../actions'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'

// Build a YYYY-MM-DD string in local terms (no TZ shift)
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function mondayOf(dateStr?: string) {
  const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date()
  const day = base.getDay() // 0 Sun … 6 Sat
  const diff = (day === 0 ? -6 : 1) - day
  base.setDate(base.getDate() + diff)
  base.setHours(0, 0, 0, 0)
  return base
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const monday = mondayOf(week)
  const days = Array.from({ length: 6 }, (_, i) => {   // Mon–Sat
    const d = new Date(monday); d.setDate(monday.getDate() + i); return d
  })
  const weekStart = iso(days[0])
  const weekEnd = iso(days[days.length - 1])

  const prev = new Date(monday); prev.setDate(monday.getDate() - 7)
  const next = new Date(monday); next.setDate(monday.getDate() + 7)

  const [{ data: entries }, { data: jobs }] = await Promise.all([
    admin.from('con_schedule_entries').select('*').eq('company_id', company_id).gte('schedule_date', weekStart).lte('schedule_date', weekEnd).order('schedule_date'),
    admin.from('con_jobs').select('id, site_number, work_order_number').eq('company_id', company_id).order('created_at', { ascending: false }),
  ])

  const dayOptions = days.map(d => ({ value: iso(d), label: d.toLocaleDateString('en-US', { weekday: 'short' }) }))
  const todayIso = iso(new Date())

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
            Schedule
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Week of {days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {days[days.length - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700 mr-1">← Construction</Link>
          <Link href={`/construction/schedule?week=${iso(prev)}`} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></Link>
          <Link href="/construction/schedule" className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50">This Week</Link>
          <Link href={`/construction/schedule?week=${iso(next)}`} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {days.map(d => {
          const di = iso(d)
          const dayEntries = (entries ?? []).filter(e => e.schedule_date === di)
          const isToday = di === todayIso
          return (
            <div key={di} className={`rounded-2xl border p-3 min-h-40 ${isToday ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-gray-50'}`}>
              <div className="mb-2 px-1">
                <p className="text-xs font-semibold text-gray-700">{d.toLocaleDateString('en-US', { weekday: 'short' })}</p>
                <p className="text-xs text-gray-400">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
              </div>
              <div className="space-y-2">
                {dayEntries.map(e => (
                  <div key={e.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-2.5">
                    <p className="text-sm font-medium text-gray-900">{e.site_number ?? e.task_description ?? '—'}</p>
                    {e.task_description && e.site_number && <p className="text-xs text-gray-500">{e.task_description}</p>}
                    {e.crew?.length ? (
                      <p className="text-xs text-gray-600 mt-1 inline-flex items-center gap-1"><Users className="w-3 h-3 text-gray-400" />{e.crew.join(', ')}</p>
                    ) : null}
                    {e.equipment && <p className="text-xs text-amber-700 mt-0.5">{e.equipment}</p>}
                    <div className="flex items-center justify-between mt-1.5">
                      {canWrite ? <ScheduleMove id={e.id} current={di} days={dayOptions} action={moveScheduleEntry} /> : <span />}
                      {canWrite && <DeleteButton action={deleteScheduleEntry.bind(null, e.id)} confirm="Remove this entry?" iconOnly />}
                    </div>
                  </div>
                ))}
                {dayEntries.length === 0 && <p className="text-xs text-gray-300 px-1">—</p>}
              </div>
            </div>
          )
        })}
      </div>

      {canWrite && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 max-w-2xl">
          <h3 className="font-semibold text-gray-900 mb-3">Add to Schedule</h3>
          <ScheduleEntryForm action={saveScheduleEntry.bind(null, null)} jobs={jobs ?? []} defaultDate={weekStart} />
        </div>
      )}
    </div>
  )
}
