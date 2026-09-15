import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canWriteInventory } from '@/lib/inventory'

export type InventoryProfile = { id: string; company_id: string; role: string; canWrite: boolean }

/**
 * Server-side guard for Inventory pages. Every signed-in user can read the
 * catalog (techs need to look parts up); writing is limited by role.
 */
export async function requireInventory(): Promise<InventoryProfile> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/dashboard')

  return { id: profile.id, company_id: profile.company_id, role: profile.role, canWrite: canWriteInventory(profile.role) }
}
