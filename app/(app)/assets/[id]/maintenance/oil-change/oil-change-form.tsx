'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export function OilChangeForm({
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
        <div className="col-span-2 sm:col-span-1">
          <label className={lbl}>Service Date <span className="text-red-500">*</span></label>
          <input name="service_date" type="date" className={inp} defaultValue={today} required />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={lbl}>Mileage at Service</label>
          <input
            name="mileage"
            type="number"
            className={inp}
            placeholder="0"
            defaultValue={currentMileage ?? ''}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Oil Type</label>
          <select name="oil_type" className={inp}>
            <option value="">— Select —</option>
            <option>5W-20</option>
            <option>5W-30</option>
            <option>5W-40</option>
            <option>10W-30</option>
            <option>15W-40</option>
            <option>0W-20</option>
            <option>Synthetic 5W-30</option>
            <option>Synthetic 5W-40</option>
            <option>Synthetic 15W-40</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Filter Used</label>
          <input name="filter_used" className={inp} placeholder="Part # or brand" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
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
        <label className={lbl}>Labor Time (minutes)</label>
        <input name="labor_minutes" type="number" className={inp} placeholder="e.g. 30" />
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={2} className={inp} placeholder="Any additional notes…" />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? 'Saving…' : 'Record Oil Change'}
      </Button>
    </form>
  )
}
