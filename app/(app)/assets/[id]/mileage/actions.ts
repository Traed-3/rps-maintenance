'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

type ActionState = { error: string } | null

export async function addMileageEntry(
  assetId: string,
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated. Please log in again.' }

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return { error: 'Profile not found.' }

  const mileageVal = formData.get('mileage') as string
  const reading = parseFloat(mileageVal)
  if (!mileageVal || isNaN(reading) || reading < 0) {
    return { error: 'Please enter a valid reading.' }
  }

  const entryDate =
    (formData.get('entry_date') as string) || new Date().toISOString().split('T')[0]

  // Verify asset belongs to this company
  const { data: asset } = await admin
    .from('assets')
    .select('id, uses_hours, current_mileage, current_hours, oil_change_interval_miles, last_oil_change_mileage')
    .eq('id', assetId)
    .eq('company_id', profile.company_id)
    .single()

  if (!asset) return { error: 'Asset not found.' }

  // Insert the mileage/hours entry (mileage_entries.mileage stores both)
  const { error: insertError } = await admin.from('mileage_entries').insert({
    company_id: profile.company_id,
    asset_id: assetId,
    submitted_by: profile.id,
    entry_date: entryDate,
    mileage: reading,
    source: 'manual',
    notes: (formData.get('notes') as string)?.trim() || null,
  })

  if (insertError) return { error: insertError.message }

  // Update the asset's current reading if this is higher
  if ((asset as any).uses_hours) {
    const currentHours = (asset as any).current_hours
    if (currentHours === null || reading > Number(currentHours)) {
      await admin.from('assets').update({ current_hours: reading }).eq('id', assetId)
    }
  } else {
    const currentMileage = asset.current_mileage
    const mileageInt = Math.round(reading)
    if (currentMileage === null || mileageInt > currentMileage) {
      const assetUpdates: Record<string, unknown> = { current_mileage: mileageInt }
      if (asset.oil_change_interval_miles && asset.last_oil_change_mileage) {
        assetUpdates.next_oil_change_mileage =
          asset.last_oil_change_mileage + asset.oil_change_interval_miles
      }
      await admin.from('assets').update(assetUpdates).eq('id', assetId)
    }
  }

  revalidatePath(`/assets/${assetId}`)
  redirect(`/assets/${assetId}`)
}
