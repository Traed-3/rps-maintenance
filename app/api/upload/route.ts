import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File
  const bucket = (formData.get('bucket') as string) || 'receipts'

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const validBuckets = ['receipts', 'asset-photos', 'ticket-attachments']
  if (!validBuckets.includes(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  const admin = createAdminClient()
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: urlData } = admin.storage.from(bucket).getPublicUrl(path)
  return NextResponse.json({ url: urlData.publicUrl })
}
