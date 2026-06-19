'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

export function JobLaborForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  return (
    <form action={formAction} className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
      <div>
        <label className={lbl}>Date</label>
        <input name="work_date" type="date" className={inp} />
      </div>
      <div>
        <label className={lbl}>Crew Member</label>
        <input name="crew_member" className={inp} placeholder="Initials/name" />
      </div>
      <div>
        <label className={lbl}>Hours <span className="text-red-500">*</span></label>
        <input name="hours" type="number" step="any" className={inp} required />
      </div>
      <div>
        <label className={lbl}>Rate $/hr</label>
        <input name="labor_rate" type="number" step="any" className={inp} />
      </div>
      <button type="submit" disabled={isPending} className="px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">
        {isPending ? '…' : 'Log'}
      </button>
      {state?.error && <p className="col-span-full text-xs text-red-600">{state.error}</p>}
      <div className="col-span-full">
        <input name="task_note" className={inp} placeholder="Task note (optional)" />
      </div>
    </form>
  )
}
