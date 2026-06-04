'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

type ActionState = { error: string } | null

function num(val: FormDataEntryValue | null) {
  if (!val || val === '') return null
  const n = parseFloat(val as string)
  return isNaN(n) ? null : n
}
function str(val: FormDataEntryValue | null) {
  const s = (val as string)?.trim()
  return s || null
}
function bool(val: FormDataEntryValue | null) {
  return val === 'on'
}

async function getProfileAndAsset(assetId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return null

  const { data: asset } = await admin
    .from('assets')
    .select('id, company_id, oil_change_interval_miles')
    .eq('id', assetId)
    .eq('company_id', profile.company_id)
    .single()
  if (!asset) return null

  return { profile, asset, admin }
}

// Record a mileage-history entry whenever a service updates the asset's mileage
async function logMileage(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  profileId: string,
  assetId: string,
  entryDate: string,
  mileage: number | null,
  note: string
) {
  if (mileage == null) return
  await admin.from('mileage_entries').insert({
    company_id: companyId,
    asset_id: assetId,
    entry_date: entryDate,
    mileage,
    source: 'manual',
    notes: note,
    submitted_by: profileId,
  })
}

async function getMaintenanceTypeId(admin: ReturnType<typeof createAdminClient>, companyId: string, name: string) {
  const { data } = await admin
    .from('maintenance_types')
    .select('id')
    .eq('company_id', companyId)
    .eq('name', name)
    .single()
  return data?.id ?? null
}

// ── OIL CHANGE ──────────────────────────────────────────────────────────────

export async function recordOilChange(
  assetId: string,
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const ctx = await getProfileAndAsset(assetId)
  if (!ctx) return { error: 'Not authenticated or asset not found.' }
  const { profile, asset, admin } = ctx

  const serviceDate = str(formData.get('service_date'))
  if (!serviceDate) return { error: 'Service date is required.' }

  const mileage = num(formData.get('mileage'))

  // Insert into oil_change_records
  const { data: record, error: recordError } = await admin
    .from('oil_change_records')
    .insert({
      asset_id: assetId,
      service_date: serviceDate,
      mileage,
      oil_type: str(formData.get('oil_type')),
      filter_used: str(formData.get('filter_used')),
      completed_by: profile.id,
      cost: num(formData.get('cost')),
      labor_minutes: num(formData.get('labor_minutes')),
      vendor: str(formData.get('vendor')),
      notes: str(formData.get('notes')),
    })
    .select('id')
    .single()

  if (recordError) return { error: recordError.message }

  // Insert into maintenance_events for unified history
  const typeId = await getMaintenanceTypeId(admin, profile.company_id, 'Oil Change')
  const nextDueMileage = mileage && asset.oil_change_interval_miles
    ? mileage + asset.oil_change_interval_miles
    : null

  await admin.from('maintenance_events').insert({
    company_id: profile.company_id,
    asset_id: assetId,
    maintenance_type_id: typeId,
    performed_by: profile.id,
    performed_date: serviceDate,
    mileage_at_service: mileage,
    next_due_mileage: nextDueMileage,
    vendor: str(formData.get('vendor')),
    cost: num(formData.get('cost')),
    labor_hours: num(formData.get('labor_minutes')) ? num(formData.get('labor_minutes'))! / 60 : null,
    notes: str(formData.get('notes')),
  })

  // Update asset fields
  await admin.from('assets').update({
    last_oil_change_date: serviceDate,
    last_oil_change_mileage: mileage,
    next_oil_change_mileage: nextDueMileage,
    ...(mileage ? { current_mileage: mileage } : {}),
  }).eq('id', assetId)

  await logMileage(admin, profile.company_id, profile.id, assetId, serviceDate, mileage, 'Oil change service')

  revalidatePath(`/assets/${assetId}`)
  redirect(`/assets/${assetId}`)
}

// ── BRAKE SERVICE ────────────────────────────────────────────────────────────

export async function recordBrakeService(
  assetId: string,
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const ctx = await getProfileAndAsset(assetId)
  if (!ctx) return { error: 'Not authenticated or asset not found.' }
  const { profile, admin } = ctx

  const serviceDate = str(formData.get('service_date'))
  if (!serviceDate) return { error: 'Service date is required.' }

  const mileage = num(formData.get('mileage'))
  const nextInspectionDate = str(formData.get('next_inspection_date'))

  const { error: recordError } = await admin.from('brake_service_records').insert({
    asset_id: assetId,
    service_date: serviceDate,
    mileage,
    front_pads: bool(formData.get('front_pads')),
    rear_pads: bool(formData.get('rear_pads')),
    front_rotors: bool(formData.get('front_rotors')),
    rear_rotors: bool(formData.get('rear_rotors')),
    calipers: bool(formData.get('calipers')),
    brake_lines: bool(formData.get('brake_lines')),
    brake_fluid: bool(formData.get('brake_fluid')),
    parking_brake: bool(formData.get('parking_brake')),
    abs_issue: bool(formData.get('abs_issue')),
    severity: str(formData.get('severity')) ?? 'monitor',
    parts_used: str(formData.get('parts_used')),
    completed_by: profile.id,
    vendor: str(formData.get('vendor')),
    cost: num(formData.get('cost')),
    labor_minutes: num(formData.get('labor_minutes')),
    next_inspection_date: nextInspectionDate,
    notes: str(formData.get('notes')),
  })

  if (recordError) return { error: recordError.message }

  const typeId = await getMaintenanceTypeId(admin, profile.company_id, 'Brakes')
  await admin.from('maintenance_events').insert({
    company_id: profile.company_id,
    asset_id: assetId,
    maintenance_type_id: typeId,
    performed_by: profile.id,
    performed_date: serviceDate,
    mileage_at_service: mileage,
    next_due_date: nextInspectionDate,
    vendor: str(formData.get('vendor')),
    cost: num(formData.get('cost')),
    notes: str(formData.get('notes')),
  })

  await admin.from('assets').update({
    last_brake_service_date: serviceDate,
    last_brake_service_mileage: mileage,
    next_brake_inspection_date: nextInspectionDate,
    ...(mileage ? { current_mileage: mileage } : {}),
  }).eq('id', assetId)

  await logMileage(admin, profile.company_id, profile.id, assetId, serviceDate, mileage, 'Brake service')

  revalidatePath(`/assets/${assetId}`)
  redirect(`/assets/${assetId}`)
}

// ── TIRE SERVICE ─────────────────────────────────────────────────────────────

export async function recordTireService(
  assetId: string,
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const ctx = await getProfileAndAsset(assetId)
  if (!ctx) return { error: 'Not authenticated or asset not found.' }
  const { profile, admin } = ctx

  const serviceDate = str(formData.get('service_date'))
  if (!serviceDate) return { error: 'Service date is required.' }

  const mileage = num(formData.get('mileage'))
  const nextInspectionDate = str(formData.get('next_inspection_date'))

  const { error: recordError } = await admin.from('tire_service_records').insert({
    asset_id: assetId,
    service_date: serviceDate,
    mileage,
    tire_position: str(formData.get('tire_position')),
    brand: str(formData.get('brand')),
    model: str(formData.get('model')),
    tread_depth: num(formData.get('tread_depth')),
    replaced: bool(formData.get('replaced')),
    inspected_only: bool(formData.get('inspected_only')),
    completed_by: profile.id,
    vendor: str(formData.get('vendor')),
    cost: num(formData.get('cost')),
    next_inspection_date: nextInspectionDate,
    next_replacement_est: str(formData.get('next_replacement_est')),
    notes: str(formData.get('notes')),
  })

  if (recordError) return { error: recordError.message }

  const typeId = await getMaintenanceTypeId(admin, profile.company_id, 'Tires')
  await admin.from('maintenance_events').insert({
    company_id: profile.company_id,
    asset_id: assetId,
    maintenance_type_id: typeId,
    performed_by: profile.id,
    performed_date: serviceDate,
    mileage_at_service: mileage,
    next_due_date: nextInspectionDate,
    vendor: str(formData.get('vendor')),
    cost: num(formData.get('cost')),
    notes: str(formData.get('notes')),
  })

  await admin.from('assets').update({
    last_tire_service_date: serviceDate,
    last_tire_service_mileage: mileage,
    next_tire_inspection_date: nextInspectionDate,
    ...(mileage ? { current_mileage: mileage } : {}),
  }).eq('id', assetId)

  await logMileage(admin, profile.company_id, profile.id, assetId, serviceDate, mileage, 'Tire service')

  revalidatePath(`/assets/${assetId}`)
  redirect(`/assets/${assetId}`)
}
