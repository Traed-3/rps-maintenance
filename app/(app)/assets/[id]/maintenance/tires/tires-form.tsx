'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export function TiresForm({
  action,
  today,
  currentMileage,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  today: string
  currentMileage: number | null
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Service Date <span className="text-red-500">*</span></label>
          <input name="service_date" type="date" className={inp} defaultValue={today} required />
        </div>
        <div>
          <label className={lbl}>Mileage at Service</label>
          <input name="mileage" type="number" className={inp} placeholder="0" defaultValue={currentMileage ?? ''} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Tire Position</label>
          <select name="tire_position" className={inp}>
            <option value="">— Select —</option>
            <option value="All">All Tires</option>
            <option value="FL">Front Left</option>
            <option value="FR">Front Right</option>
            <option value="RL">Rear Left</option>
            <option value="RR">Rear Right</option>
            <option value="Spare">Spare</option>
            <option value="Dual Rear">Dual Rear</option>
            <option value="All Rear">All Rear</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Tread Depth (32nds)</label>
          <input name="tread_depth" type="number" step="0.5" className={inp} placeholder="e.g. 8.5" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Tire Brand</label>
          <input name="brand" className={inp} placeholder="Goodyear, Michelin…" />
        </div>
        <div>
          <label className={lbl}>Tire Model</label>
          <input name="model" className={inp} placeholder="Model name" />
        </div>
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" name="replaced" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          Tire(s) Replaced
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" name="inspected_only" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          Inspection Only
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Next Inspection Date</label>
          <input name="next_inspection_date" type="date" className={inp} />
        </div>
        <div>
          <label className={lbl}>Est. Replacement Date</label>
          <input name="next_replacement_est" type="date" className={inp} />
        </div>
        <div>
          <label className={lbl}>Vendor / Shop</label>
          <input name="vendor" className={inp} placeholder="Who did the work?" />
        </div>
        <div>
          <label className={lbl}>Cost ($)</label>
          <input name="cost" type="number" step="0.01" className={inp} placeholder="0.00" />
        </div>
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={2} className={inp} placeholder="Condition notes, observations…" />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? 'Saving…' : 'Record Tire Service'}
      </Button>
    </form>
  )
}
