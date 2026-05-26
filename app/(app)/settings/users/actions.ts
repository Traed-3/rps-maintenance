'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

export async function updateUserRole(userId: string, newRole: string) {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return
  if (userId === profile.id) return  // can't change own role

  const validRoles = ['owner', 'manager', 'shop_manager', 'shop_employee', 'viewer']
  if (!validRoles.includes(newRole)) return

  const admin = createAdminClient()
  await admin.from('profiles').update({ role: newRole })
    .eq('id', userId)
    .eq('company_id', profile.company_id)

  revalidatePath('/settings/users')
}

export async function toggleUserActive(userId: string, isActive: boolean) {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return
  if (userId === profile.id) return  // can't deactivate yourself

  const admin = createAdminClient()
  await admin.from('profiles').update({ is_active: isActive })
    .eq('id', userId)
    .eq('company_id', profile.company_id)

  revalidatePath('/settings/users')
}
