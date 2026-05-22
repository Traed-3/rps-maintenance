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

  // Any authenticated company member can submit mileage
  const mileageVal = formData.get('mileage') as string
  const mileage = parseInt(mileageVal, 10)
  if (!mileageVal || isNaN(mileage) || mileage < 0) {
    return { error: 'Please enter a valid mileage reading.' }
  }

  const entryDate =
    (formData.get('entry_date') as string) || new Date().toISOString().split('T')[0]

  // Verify asset belongs to this company
  const { data: asset } = await admin
    .from('assets')
    .select('id, current_mileage, oil_change_interval_miles, last_oil_change_mileage')
    .eq('id', assetId)
    .eq('company_id', profile.company_id)
    .single()

  if (!asset) return { error: 'Asset not found.' }

  // Insert the mileage entry
  const { error: insertError } = await admin.from('mileage_entries').insert({
    company_id: profile.company_id,
    asset_id: assetId,
    submitted_by: profile.id,
    entry_date: entryDate,
    mileage,
    source: 'manual',
    notes: (formData.get('notes') as string)?.trim() || null,
  })

  if (insertError) return { error: insertError.message }

  // Update current_mileage on the asset if this reading is higher
  if (asset.current_mileage === null || mileage > asset.current_mileage) {
    const assetUpdates: Record<string, unknown> = { current_mileage: mileage }

    // Recalculate next oil change mileage if we have enough data
    if (asset.oil_change_interval_miles && asset.last_oil_change_mileage) {
      assetUpdates.next_oil_change_mileage =
        asset.last_oil_change_mileage + asset.oil_change_interval_miles
    }

    await admin.from('assets').update(assetUpdates).eq('id', assetId)
  }

  revalidatePath(`/assets/${assetId}`)
  redirect(`/assets/${assetId}`)
}
