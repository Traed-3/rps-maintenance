'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, Check } from 'lucide-react'

type Reminder = { id: string; title: string; unit: string | null; dueDate: string | null }
type Filter = 'all' | 'registration' | 'inspection'

function kind(title: string): 'registration' | 'inspection' {
  return /^registration/i.test(title) ? 'registration' : 'inspection'
}

export function RemindersCard({
  reminders,
  onComplete,
}: {
  reminders: Reminder[]
  onComplete: (id: string) => Promise<void>
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const regCount = reminders.filter((r) => kind(r.title) === 'registration').length
  const inspCount = reminders.filter((r) => kind(r.title) === 'inspection').length
  const shown = reminders.filter((r) => filter === 'all' || kind(r.title) === filter)

  function handleDone(id: string) {
    setBusyId(id)
    startTransition(async () => {
      await onComplete(id)
      setBusyId(null)
    })
  }

  const FILTERS: { value: Filter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: reminders.length },
    { value: 'registration', label: 'Registration Due', count: regCount },
    { value: 'inspection', label: 'State Inspection Due', count: inspCount },
  ]

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-bold text-gray-900">Reminders</h2>
          <span className="text-xs text-gray-500">({reminders.length})</span>
        </div>
        {/* Filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                filter === f.value
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {shown.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-400">No reminders. 🎉</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {shown.map((r) => {
              const k = kind(r.title)
              const overdue = r.dueDate ? new Date(r.dueDate) < new Date() : false
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
                      k === 'registration'
                        ? 'bg-blue-50 text-blue-700 border-blue-100'
                        : 'bg-amber-50 text-amber-700 border-amber-100'
                    }`}>
                      {k === 'registration' ? 'Registration' : 'State Insp.'}
                    </span>
                    <span className="font-semibold text-gray-900 shrink-0">{r.unit ?? '—'}</span>
                    {r.dueDate && (
                      <span className={`text-xs shrink-0 ${overdue ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                        {new Date(r.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {overdue ? ' · overdue' : ''}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDone(r.id)}
                    disabled={isPending && busyId === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-50 transition-colors shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {isPending && busyId === r.id ? 'Saving…' : 'Done'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
