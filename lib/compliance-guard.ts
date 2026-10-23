import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadCompliance, canWriteCompliance } from '@/lib/compliance'

export type ComplianceProfile = { id: string; company_id: string; role: string; canWrite: boolean }

/** Server-side guard for /compliance pages: redirects away anyone without the role or with the module blocked. */
export async function requireCompliance(): Promise<ComplianceProfile> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadCompliance(profile)) redirect('/dashboard')
  const { data: block } = await admin.from('profile_module_blocks').select('module').eq('profile_id', user.id).eq('module', 'compliance').maybeSingle()
  if (block) redirect('/dashboard')

  return { ...(profile as { id: string; company_id: string; role: string }), canWrite: canWriteCompliance(profile) }
}

/** Same check for server actions / route handlers — returns null instead of redirecting. */
export async function complianceCaller(write = false): Promise<ComplianceProfile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadCompliance(profile)) return null
  if (write && !canWriteCompliance(profile)) return null
  const { data: block } = await admin.from('profile_module_blocks').select('module').eq('profile_id', user.id).eq('module', 'compliance').maybeSingle()
  if (block) return null
  return { ...(profile as { id: string; company_id: string; role: string }), canWrite: canWriteCompliance(profile) }
}
