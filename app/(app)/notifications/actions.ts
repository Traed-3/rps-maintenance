'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id').eq('id', user.id).single()
  return data
}

export async function markNotificationRead(notificationId: string) {
  const profile = await getProfile()
  if (!profile) return
  const admin = createAdminClient()
  await admin.from('notifications').update({ is_read: true }).eq('id', notificationId)
  revalidatePath('/', 'layout')
}

export async function markAllNotificationsRead() {
  const profile = await getProfile()
  if (!profile) return
  const admin = createAdminClient()
  await admin
    .from('notifications')
    .update({ is_read: true })
    .eq('company_id', profile.company_id)
    .or(`recipient_id.eq.${profile.id},recipient_id.is.null`)
  revalidatePath('/', 'layout')
}
