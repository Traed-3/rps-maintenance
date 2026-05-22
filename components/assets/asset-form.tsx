'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

type AssetType = { id: string; name: string }
type ActionState = { error: string } | null

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

const statusOptions = [
  { value: 'active',    label: 'Active' },
  { value: 'available', label: 'Available' },
  { value: 'in_shop',   label: 'In Shop' },
  { value: 'down',      label: 'Down' },
  { value: 'unsafe',    label: 'Unsafe' },
  { value: 'retired',   label: 'Retired' },
]

type Asset = {
  id: string
  unit_number: string
  asset_type_id: string | null
  name: string | null
  status: string
  year: number | null
  make: string | null
  model: string | null
  vin: string | null
  serial_number: string | null
  license_plate: string | null
  current_mileage: number | null
  oil_change_interval_miles: number | null
  oil_change_interval_months: number | null
  last_oil_change_date: string | null
  last_oil_change_mileage: number | null
  inspection_due_date: string | null
  dot_inspection_due_date: string | null
  registration_due_date: string | null
  insurance_due_date: string | null
  notes: string | null
}

export function AssetForm({
  action,
  assetTypes,
  asset,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  assetTypes: AssetType[]
  asset?: Asset
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const v = asset // shorthand for default values

  return (
    <form action={formAction} className="space-y-8">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {/* Basic Info */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Basic Info
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Unit Number <span className="text-red-500">*</span>
            </label>
            <input
              name="unit_number"
              className={inputClass}
              placeholder="e.g. T-101, EQ-05"
              defaultValue={v?.unit_number ?? ''}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Asset Type</label>
            <select name="asset_type_id" className={inputClass} defaultValue={v?.asset_type_id ?? ''}>
              <option value="">— Select type —</option>
              {assetTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Status</label>
            <select name="status" className={inputClass} defaultValue={v?.status ?? 'active'}>
              {statusOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Name / Description</label>
            <input
              name="name"
              className={inputClass}
              placeholder="Optional label for this asset"
              defaultValue={v?.name ?? ''}
            />
          </div>
        </div>
      </section>

      {/* Vehicle Details */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Vehicle Details
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Year</label>
            <input
              name="year"
              type="number"
              className={inputClass}
              placeholder="2021"
              defaultValue={v?.year ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Make</label>
            <input
              name="make"
              className={inputClass}
              placeholder="Ford"
              defaultValue={v?.make ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Model</label>
            <input
              name="model"
              className={inputClass}
              placeholder="F-550"
              defaultValue={v?.model ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>VIN</label>
            <input
              name="vin"
              className={inputClass}
              placeholder="17-character VIN"
              defaultValue={v?.vin ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Serial Number</label>
            <input
              name="serial_number"
              className={inputClass}
              placeholder="For trailers / equipment"
              defaultValue={v?.serial_number ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>License Plate</label>
            <input
              name="license_plate"
              className={inputClass}
              placeholder="ABC-1234"
              defaultValue={v?.license_plate ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Current Mileage</label>
            <input
              name="current_mileage"
              type="number"
              className={inputClass}
              placeholder="0"
              defaultValue={v?.current_mileage ?? ''}
            />
          </div>
        </div>
      </section>

      {/* Oil Change Service */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Oil Change Service
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Change Interval (miles)</label>
            <input
              name="oil_change_interval_miles"
              type="number"
              className={inputClass}
              placeholder="e.g. 5000"
              defaultValue={v?.oil_change_interval_miles ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Change Interval (months)</label>
            <input
              name="oil_change_interval_months"
              type="number"
              className={inputClass}
              placeholder="e.g. 6"
              defaultValue={v?.oil_change_interval_months ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Last Oil Change Date</label>
            <input
              name="last_oil_change_date"
              type="date"
              className={inputClass}
              defaultValue={v?.last_oil_change_date ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Last Oil Change Mileage</label>
            <input
              name="last_oil_change_mileage"
              type="number"
              className={inputClass}
              placeholder="0"
              defaultValue={v?.last_oil_change_mileage ?? ''}
            />
          </div>
        </div>
      </section>

      {/* Due Dates */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Due Dates
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Inspection Due</label>
            <input
              name="inspection_due_date"
              type="date"
              className={inputClass}
              defaultValue={v?.inspection_due_date ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>DOT Inspection Due</label>
            <input
              name="dot_inspection_due_date"
              type="date"
              className={inputClass}
              defaultValue={v?.dot_inspection_due_date ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Registration / Tag Due</label>
            <input
              name="registration_due_date"
              type="date"
              className={inputClass}
              defaultValue={v?.registration_due_date ?? ''}
            />
          </div>
          <div>
            <label className={labelClass}>Insurance Due</label>
            <input
              name="insurance_due_date"
              type="date"
              className={inputClass}
              defaultValue={v?.insurance_due_date ?? ''}
            />
          </div>
        </div>
      </section>

      {/* Notes */}
      <section>
        <label className={labelClass}>Notes</label>
        <textarea
          name="notes"
          rows={3}
          className={inputClass}
          placeholder="Any additional notes about this asset..."
          defaultValue={v?.notes ?? ''}
        />
      </section>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : asset ? 'Save Changes' : 'Add Asset'}
        </Button>
        <a href="/assets" className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </a>
      </div>
    </form>
  )
}
