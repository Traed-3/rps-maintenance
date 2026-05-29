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

  const validRoles = ['owner', 'manager', 'shop_manager', 'shop_employee', 'mechanic', 'service_tech', 'construction_tech', 'office_staff', 'viewer']
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

type CreateEmployeeState = { error?: string; success?: boolean } | null

export async function createEmployee(
  _state: CreateEmployeeState,
  formData: FormData
): Promise<CreateEmployeeState> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) {
    return { error: 'You do not have permission to add employees.' }
  }

  const fullName = (formData.get('full_name') as string)?.trim()
  const email    = (formData.get('email') as string)?.trim().toLowerCase()
  const role     = (formData.get('role') as string)?.trim()

  if (!fullName || !email) return { error: 'Name and email are required.' }

  const validRoles = ['owner', 'manager', 'shop_manager', 'shop_employee', 'mechanic', 'service_tech', 'construction_tech', 'office_staff', 'viewer']
  if (!validRoles.includes(role)) return { error: 'Invalid role.' }

  const admin = createAdminClient()

  // Check if a profile with this email already exists in the company
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('company_id', profile.company_id)
    .eq('email', email)
    .maybeSingle()

  if (existing) return { error: 'An employee with that email already exists.' }

  // Create the auth user via admin API (email_confirm = true so they don't need to verify)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authError || !authData.user) {
    // If user already exists in auth (different company), surface a clear message
    if (authError?.message?.includes('already been registered')) {
      return { error: 'That email is already registered. Ask them to sign in with Google — they can be assigned a role from there.' }
    }
    return { error: authError?.message ?? 'Failed to create user account.' }
  }

  // Create the profile row
  const { error: profileError } = await admin.from('profiles').insert({
    id: profile.company_id ? authData.user.id : authData.user.id,
    company_id: profile.company_id,
    full_name: fullName,
    email,
    role,
    is_active: true,
  })

  if (profileError) {
    // Rollback the auth user if profile creation fails
    await admin.auth.admin.deleteUser(authData.user.id)
    return { error: profileError.message }
  }

  revalidatePath('/settings/users')
  return { success: true }
}
