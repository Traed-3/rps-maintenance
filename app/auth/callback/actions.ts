'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Called by the client-side callback page after exchangeCodeForSession succeeds.
 * Creates a profile row if this is the user's first login.
 * The first user in a company automatically becomes the owner.
 */
export async function ensureProfile(
  userId: string,
  email: string,
  metadata: Record<string, unknown>
) {
  // Verify the caller is actually authenticated.
  // After exchangeCodeForSession the browser has session cookies; they are
  // sent with this server-action POST because it is a same-site request.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || user.id !== userId) {
    throw new Error('Unauthorized: user mismatch')
  }

  const admin = createAdminClient()

  // Check whether a profile already exists for this user
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()

  if (existingProfile) return // Nothing to do

  // Find the RPS company
  const { data: company } = await admin
    .from('companies')
    .select('id')
    .eq('slug', 'rps')
    .single()

  const fullName =
    (metadata?.full_name as string | undefined) ??
    (metadata?.name as string | undefined) ??
    email.split('@')[0] ??
    'Unknown'

  // First owner check: if no one has the owner role yet, make this user owner
  let role = 'viewer'
  if (company?.id) {
    const { count } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', company.id)
      .eq('role', 'owner')
    if ((count ?? 0) === 0) role = 'owner'
  }

  await admin.from('profiles').insert({
    id: userId,
    company_id: company?.id ?? null,
    full_name: fullName,
    email,
    role,
  })
}
