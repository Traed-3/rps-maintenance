'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

export function MileageForm({
  action,
  today,
  usesHours,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  today: string
  usesHours?: boolean
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const label = usesHours ? 'Hours' : 'Mileage'
  const unit = usesHours ? 'hours' : 'miles'

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label} Reading <span className="text-red-500">*</span>
        </label>
        <input
          name="mileage"
          type="number"
          min="0"
          step={usesHours ? '0.1' : '1'}
          required
          autoFocus
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-2xl font-bold text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="0"
        />
        <p className="text-xs text-gray-400 mt-1">Enter the current reading in {unit}.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
        <input name="entry_date" type="date" className={inputClass} defaultValue={today} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
        <textarea
          name="notes"
          rows={2}
          className={inputClass}
          placeholder="e.g. End of shift, fuel stop, etc."
        />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? 'Saving…' : `Submit ${label}`}
      </Button>
    </form>
  )
}
