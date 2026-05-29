'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null
const inp = 'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

type Ticket = { id: string; ticket_number: string; title: string; unit_number?: string | null }

const ENTRY_TYPES = [
  { value: 'ticket',                   label: '🎫 Open Ticket' },
  { value: 'general_shop',             label: '🏭 General Shop Work' },
  { value: 'mowing_225',               label: '🌿 Mowing — 225' },
  { value: 'mowing_861',               label: '🌿 Mowing — 861' },
  { value: 'general_maintenance_225',  label: '⚙️ General Maintenance — 225' },
  { value: 'general_maintenance_861',  label: '⚙️ General Maintenance — 861' },
  { value: 'dispenser_purging',        label: '🔧 Dispenser Purging' },
  { value: 'special_assignment',       label: '⭐ Special Assignment' },
  { value: 'break',                    label: '☕ Break' },
  { value: 'lunch',                    label: '🍽️ Lunch' },
  { value: 'other',                    label: '• Other' },
]

export function GeneralTimeForm({
  action,
  disabled,
  openTickets = [],
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  disabled: boolean
  openTickets?: Ticket[]
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [entryType, setEntryType] = useState('general_shop')

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {/* Type selector */}
      <div>
        <label className={lbl}>Type</label>
        <select
          name="entry_type"
          className={inp}
          disabled={disabled}
          value={entryType}
          onChange={e => setEntryType(e.target.value)}
        >
          {ENTRY_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Ticket picker — shown when "Open Ticket" is selected */}
      {entryType === 'ticket' && (
        <div>
          <label className={lbl}>Select Ticket <span className="text-red-500">*</span></label>
          {openTickets.length === 0 ? (
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              No open tickets found.
            </p>
          ) : (
            <select name="ticket_id" className={inp} disabled={disabled} required>
              <option value="">— Select a ticket —</option>
              {openTickets.map(t => (
                <option key={t.id} value={t.id}>
                  {t.ticket_number} — {t.title.slice(0, 40)}
                  {t.unit_number ? ` (${t.unit_number})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Duration */}
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

      {/* Description */}
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
