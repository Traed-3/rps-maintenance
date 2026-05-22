import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/assets/status-badge'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import { deleteAsset } from '../actions'

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null
  return (
    <div className="py-2.5 flex gap-4">
      <span className="w-44 shrink-0 text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}

function DueDate({ label, date }: { label: string; date?: string | null }) {
  if (!date) return null
  const due = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000)

  let statusClass = 'text-green-700 bg-green-50 border-green-200'
  let note = `${diffDays} days away`
  if (diffDays < 0) {
    statusClass = 'text-red-700 bg-red-50 border-red-200'
    note = `${Math.abs(diffDays)} days overdue`
  } else if (diffDays <= 7) {
    statusClass = 'text-red-600 bg-red-50 border-red-200'
    note = `Due in ${diffDays} days`
  } else if (diffDays <= 14) {
    statusClass = 'text-orange-600 bg-orange-50 border-orange-200'
    note = `Due in ${diffDays} days`
  } else if (diffDays <= 30) {
    statusClass = 'text-amber-600 bg-amber-50 border-amber-200'
    note = `Due in ${diffDays} days`
  }

  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${statusClass}`}>
      <span className="font-medium">{label}</span>
      <span>
        {due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        <span className="ml-2 text-xs opacity-75">({note})</span>
      </span>
    </div>
  )
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // In Next.js 16, params is a Promise
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', user!.id)
    .single()

  const { data: asset } = await admin
    .from('assets')
    .select('*, asset_types(name)')
    .eq('id', id)
    .eq('company_id', profile!.company_id)
    .single()

  if (!asset) notFound()

  const canManage = ['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')
  const canDelete = ['owner', 'manager'].includes(profile?.role ?? '')

  const vehicleLabel = [asset.year, asset.make, asset.model].filter(Boolean).join(' ')

  async function handleDelete() {
    'use server'
    await deleteAsset(id)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Back link */}
      <Link href="/assets" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to Assets
      </Link>

      {/* Header */}
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{asset.unit_number}</h1>
            <StatusBadge status={asset.status} />
          </div>
          {vehicleLabel && <p className="text-gray-500 mt-0.5">{vehicleLabel}</p>}
          {asset.name && <p className="text-sm text-gray-400">{asset.name}</p>}
        </div>
        {canManage && (
          <Link href={`/assets/${id}/edit`}>
            <Button variant="outline" className="gap-2 shrink-0">
              <Pencil className="w-4 h-4" />
              Edit
            </Button>
          </Link>
        )}
      </div>

      <div className="mt-6 space-y-5">
        {/* Asset Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Asset Info</h2>
          <div className="divide-y divide-gray-50">
            <InfoRow label="Asset Type" value={(asset as any).asset_types?.name} />
            <InfoRow label="Unit Number" value={asset.unit_number} />
            <InfoRow label="Year" value={asset.year} />
            <InfoRow label="Make" value={asset.make} />
            <InfoRow label="Model" value={asset.model} />
            <InfoRow label="VIN" value={asset.vin} />
            <InfoRow label="Serial Number" value={asset.serial_number} />
            <InfoRow label="License Plate" value={asset.license_plate} />
            <InfoRow
              label="Current Mileage"
              value={asset.current_mileage != null ? `${asset.current_mileage.toLocaleString()} mi` : null}
            />
          </div>
        </div>

        {/* Oil Change */}
        {(asset.last_oil_change_date || asset.oil_change_interval_miles) && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-2">Oil Change</h2>
            <div className="divide-y divide-gray-50">
              <InfoRow label="Last Oil Change" value={asset.last_oil_change_date} />
              <InfoRow
                label="Last Oil Change Mi"
                value={asset.last_oil_change_mileage != null ? `${asset.last_oil_change_mileage.toLocaleString()} mi` : null}
              />
              <InfoRow
                label="Next Oil Change Mi"
                value={asset.next_oil_change_mileage != null ? `${asset.next_oil_change_mileage.toLocaleString()} mi` : null}
              />
              <InfoRow label="Interval (miles)" value={asset.oil_change_interval_miles ? `every ${asset.oil_change_interval_miles.toLocaleString()} mi` : null} />
              <InfoRow label="Interval (months)" value={asset.oil_change_interval_months ? `every ${asset.oil_change_interval_months} months` : null} />
            </div>
          </div>
        )}

        {/* Due Dates */}
        {(asset.inspection_due_date || asset.dot_inspection_due_date || asset.registration_due_date || asset.insurance_due_date) && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Due Dates</h2>
            <div className="space-y-2">
              <DueDate label="Inspection" date={asset.inspection_due_date} />
              <DueDate label="DOT Inspection" date={asset.dot_inspection_due_date} />
              <DueDate label="Registration / Tag" date={asset.registration_due_date} />
              <DueDate label="Insurance" date={asset.insurance_due_date} />
            </div>
          </div>
        )}

        {/* Notes */}
        {asset.notes && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-2">Notes</h2>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{asset.notes}</p>
          </div>
        )}

        {/* Danger zone */}
        {canDelete && (
          <div className="bg-white rounded-xl border border-red-100 p-5">
            <h2 className="font-semibold text-red-700 mb-1">Danger Zone</h2>
            <p className="text-sm text-gray-500 mb-3">
              Permanently delete this asset and all its records. This cannot be undone.
            </p>
            <form action={handleDelete}>
              <Button
                type="submit"
                variant="destructive"
                className="text-sm"
                onClick={(e) => {
                  if (!confirm(`Delete ${asset.unit_number}? This cannot be undone.`)) {
                    e.preventDefault()
                  }
                }}
              >
                Delete Asset
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
