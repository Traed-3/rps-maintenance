import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { complianceCaller } from '@/lib/compliance-guard'
import { HR_BUCKET } from '@/lib/compliance'

// Short-lived signed URL for a scanned card / DQF document (private bucket), after checking the caller's access.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await complianceCaller()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: item } = await admin.from('hr_employee_items').select('document_path, company_id').eq('id', id).single()
  if (!item || item.company_id !== me.company_id || !item.document_path) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { data, error } = await admin.storage.from(HR_BUCKET).createSignedUrl(item.document_path, 60 * 5)
  if (error || !data) return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
