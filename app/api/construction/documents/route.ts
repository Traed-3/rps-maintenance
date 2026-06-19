import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canWriteConstruction } from '@/lib/construction'

const BUCKET = 'construction-docs'

// Upload a construction document (permit, signed quote, close-out photo, …)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canWriteConstruction(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const jobId = (formData.get('job_id') as string)?.trim() || null
  const quoteId = (formData.get('quote_id') as string)?.trim() || null
  const invoiceId = (formData.get('invoice_id') as string)?.trim() || null
  const docType = (formData.get('doc_type') as string)?.trim() || null

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
  const path = `${profile.company_id}/${jobId ?? quoteId ?? invoiceId ?? 'general'}/${Date.now()}-${safe || `file.${ext}`}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { error: insErr } = await admin.from('con_documents').insert({
    company_id: profile.company_id,
    job_id: jobId,
    quote_id: quoteId,
    invoice_id: invoiceId,
    file_name: file.name,
    storage_path: path,
    doc_type: docType,
    uploaded_by: profile.id,
  })
  if (insErr) {
    // best-effort cleanup so we don't orphan the upload
    await admin.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
