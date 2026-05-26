import { NextResponse } from 'next/server'
import { changeTicketStatus } from '@/app/(app)/tickets/actions'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { nextStatus } = await request.json()
  if (!nextStatus) return NextResponse.json({ error: 'Missing nextStatus' }, { status: 400 })
  await changeTicketStatus(id, nextStatus)
  return NextResponse.json({ ok: true })
}
