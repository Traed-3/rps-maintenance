'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

export async function addPaymentMethodDirect(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return

  const code = (formData.get('code') as string)?.trim().toUpperCase()
  const name = (formData.get('name') as string)?.trim()
  if (!code || !name) return

  await admin.from('payment_methods').insert({ company_id: profile.company_id, code, name })
  revalidatePath('/settings/payment-methods')
}
