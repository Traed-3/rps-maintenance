'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ImageUpload } from '@/components/ui/image-upload'
import { DateInput } from '@/components/ui/date-input'

type AssetType = { id: string; name: string }
type Employee = { id: string; full_name: string }
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
  license_plate: string | null
  current_mileage: number | null
  current_hours: number | null
  uses_hours: boolean
  assigned_profile_id: string | null
  oil_change_interval_miles: number | null
  oil_change_interval_months: number | null
  last_oil_change_date: string | null
  last_oil_change_mileage: number | null
  inspection_due_date: string | null
  registration_due_date: string | null
  notes: string | null
}

export function AssetForm({
  action,
  assetTypes,
  employees,
  asset,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  assetTypes: AssetType[]
  employees: Employee[]
  asset?: Asset
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [usesHours, setUsesHours] = useState(asset?.uses_hours ?? false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [selectedTypeId, setSelectedTypeId] = useState(asset?.asset_type_id ?? '')
  // Controlled date states — browser cannot auto-fill these with today's date
  const [lastOilDate,      setLastOilDate]      = useState(asset?.last_oil_change_date  ?? '')
  const [inspectionDate,   setInspectionDate]   = useState(asset?.inspection_due_date   ?? '')
  const [registrationDate, setRegistrationDate] = useState(asset?.registration_due_date ?? '')
  const v = asset

  const mileLabel = usesHours ? 'Hours' : 'Miles'

  const selectedTypeName = assetTypes.find(t => t.id === selectedTypeId)?.name ?? ''

  // Oil change: hide for Trailer, Equipment, Machine, Other
  const NO_OIL_TYPES = ['Trailer', 'Equipment', 'Machine', 'Other']
  const showOilChange = !NO_OIL_TYPES.includes(selectedTypeName)

  // Registration/Tag: hide for Equipment, Machine, Other (Trailers DO need tags)
  const NO_REGISTRATION_TYPES = ['Equipment', 'Machine', 'Other']
  const showRegistration = !NO_REGISTRATION_TYPES.includes(selectedTypeName)

  return (
    <form action={formAction} className="space-y-8" autoComplete="off">
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
            <select
              name="asset_type_id"
              className={inputClass}
              value={selectedTypeId}
              onChange={e => setSelectedTypeId(e.target.value)}
            >
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
            <label className={labelClass}>Assigned To</label>
            <select name="assigned_profile_id" className={inputClass} defaultValue={v?.assigned_profile_id ?? ''}>
              <option value="">— Unassigned —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
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

      {/* Vehicle / Equipment Details */}
      <section>
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Vehicle / Equipment Details</h2>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              name="uses_hours"
              value="true"
              checked={usesHours}
              onChange={(e) => setUsesHours(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600 font-medium">Tracks hours (not miles)</span>
          </label>
        </div>
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
            <label className={labelClass}>VIN / Serial Number</label>
            <input
              name="vin"
              className={inputClass}
              placeholder="VIN, serial, or ID number"
              defaultValue={v?.vin ?? ''}
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
            <label className={labelClass}>Current {mileLabel}</label>
            <input
              name="current_mileage"
              type="number"
              className={inputClass}
              placeholder="0"
              defaultValue={usesHours ? (v?.current_hours ?? '') : (v?.current_mileage ?? '')}
            />
          </div>
        </div>
      </section>

      {/* Oil / Service Interval — hidden for Trailer and other non-engine asset types */}
      <section className={showOilChange ? '' : 'hidden'} aria-hidden={!showOilChange}>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
          Oil Change / Service Interval
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Change Interval ({mileLabel.toLowerCase()})</label>
            <input
              name="oil_change_interval_miles"
              type="number"
              className={inputClass}
              placeholder={usesHours ? 'e.g. 250' : 'e.g. 5000'}
              defaultValue={v?.oil_change_interval_miles ?? ''}
            />
          </div>
          <div className="hidden">
            <input
              name="oil_change_interval_months"
              type="number"
              defaultValue={v?.oil_change_interval_months ?? ''}
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>
          <div>
            <label className={labelClass}>Last Oil Change Date</label>
            <DateInput
              name="last_oil_change_date"
              value={lastOilDate}
              onChange={setLastOilDate}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Last Oil Change {mileLabel}</label>
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
            <DateInput
              name="inspection_due_date"
              value={inspectionDate}
              onChange={setInspectionDate}
              className={inputClass}
            />
          </div>
          {showRegistration && (
            <div>
              <label className={labelClass}>Registration / Tag Due</label>
              <DateInput
                name="registration_due_date"
                value={registrationDate}
                onChange={setRegistrationDate}
                className={inputClass}
              />
            </div>
          )}

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

      {/* Photo — only shown when adding a new asset */}
      {!asset && (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">
            Asset Photo <span className="text-sm font-normal text-gray-400">(optional)</span>
          </h2>
          <input type="hidden" name="photo_url" value={photoUrl ?? ''} />
          <ImageUpload
            bucket="asset-photos"
            value={photoUrl}
            onChange={setPhotoUrl}
            label="Take or Upload Asset Photo"
          />
          <p className="text-xs text-gray-400 mt-2">
            You can also add more photos from the asset detail page after saving.
          </p>
        </section>
      )}

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
