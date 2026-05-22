'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

const checkboxes = [
  { name: 'front_pads',     label: 'Front Pads' },
  { name: 'rear_pads',      label: 'Rear Pads' },
  { name: 'front_rotors',   label: 'Front Rotors' },
  { name: 'rear_rotors',    label: 'Rear Rotors' },
  { name: 'calipers',       label: 'Calipers' },
  { name: 'brake_lines',    label: 'Brake Lines' },
  { name: 'brake_fluid',    label: 'Brake Fluid' },
  { name: 'parking_brake',  label: 'Parking Brake' },
  { name: 'abs_issue',      label: 'ABS Issue Noted' },
]

export function BrakesForm({
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

      {/* Severity */}
      <div>
        <label className={lbl}>Brake Condition / Severity</label>
        <select name="severity" className={inp}>
          <option value="monitor">Monitor — watching it</option>
          <option value="needs_inspection">Needs Inspection</option>
          <option value="schedule_soon">Schedule Soon</option>
          <option value="unsafe">Unsafe — do not use</option>
        </select>
      </div>

      {/* Parts serviced checkboxes */}
      <div>
        <p className={lbl}>Parts Serviced / Inspected</p>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {checkboxes.map((cb) => (
            <label key={cb.name} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                name={cb.name}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {cb.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className={lbl}>Parts Used / Description</label>
        <input name="parts_used" className={inp} placeholder="Part numbers, brands, etc." />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Next Inspection Date</label>
          <input name="next_inspection_date" type="date" className={inp} />
        </div>
        <div>
          <label className={lbl}>Vendor / Shop</label>
          <input name="vendor" className={inp} placeholder="Who did the work?" />
        </div>
        <div>
          <label className={lbl}>Cost ($)</label>
          <input name="cost" type="number" step="0.01" className={inp} placeholder="0.00" />
        </div>
        <div>
          <label className={lbl}>Labor (minutes)</label>
          <input name="labor_minutes" type="number" className={inp} placeholder="e.g. 90" />
        </div>
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={2} className={inp} placeholder="Any additional observations…" />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? 'Saving…' : 'Record Brake Service'}
      </Button>
    </form>
  )
}
