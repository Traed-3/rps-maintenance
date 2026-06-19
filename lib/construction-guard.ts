import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadConstruction, canWriteConstruction, type ConProfile } from '@/lib/construction'

/**
 * Server-side guard for construction pages. Returns the caller's profile plus a
 * `canWrite` flag, or redirects away if they may not see the module at all.
 */
export async function requireConstruction(): Promise<ConProfile & { canWrite: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || !canReadConstruction(profile.role)) redirect('/dashboard')

  return { ...(profile as ConProfile), canWrite: canWriteConstruction(profile.role) }
}
