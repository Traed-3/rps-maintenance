'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null
const inp = 'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

const ENTRY_TYPES = [
  { value: 'general_shop',       label: '🏭 General Shop Work' },
  { value: 'break',              label: '☕ Break' },
  { value: 'lunch',              label: '🍽️ Lunch' },
  { value: 'other',              label: '• Other' },
]

export function GeneralTimeForm({
  action,
  disabled,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  disabled: boolean
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div>
        <label className={lbl}>Type</label>
        <select name="entry_type" className={inp} disabled={disabled}>
          {ENTRY_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={lbl}>Duration (minutes) <span className="text-red-500">*</span></label>
        <input
          name="duration_minutes"
          type="number"
          min="1"
          max="480"
          className={inp}
          placeholder="e.g. 30"
          disabled={disabled}
          required
        />
      </div>

      <div>
        <label className={lbl}>Description (optional)</label>
        <input
          name="description"
          className={inp}
          placeholder="Brief note about what you did"
          disabled={disabled}
        />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isPending || disabled}>
        {isPending ? 'Saving…' : 'Log Time'}
      </Button>
    </form>
  )
}
