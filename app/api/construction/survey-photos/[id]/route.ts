import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadConstruction } from '@/lib/construction'

const BUCKET = 'construction-docs'

/** Short-lived signed URL for one survey photo (thumbnails on the survey editor). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadConstruction(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data: ph } = await admin.from('con_survey_photos').select('storage_path, company_id').eq('id', id).single()
  if (!ph || ph.company_id !== profile.company_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(ph.storage_path, 60 * 10)
  if (error || !data) return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
