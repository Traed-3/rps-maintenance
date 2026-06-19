import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadConstruction } from '@/lib/construction'

const BUCKET = 'construction-docs'

// Generate a short-lived signed URL for a private construction document and
// redirect to it, after verifying the caller may read this company's files.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadConstruction(profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: doc } = await admin
    .from('con_documents').select('storage_path, company_id').eq('id', id).single()
  if (!doc || doc.company_id !== profile.company_id || !doc.storage_path) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60 * 5)
  if (error || !data) return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 })

  return NextResponse.redirect(data.signedUrl)
}
