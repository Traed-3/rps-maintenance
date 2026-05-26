'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

type ActionState = { error: string } | null

function str(val: FormDataEntryValue | null) {
  const s = (val as string)?.trim()
  return s || null
}
function bool(val: FormDataEntryValue | null) {
  return val === 'on'
}

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

// ── Create ticket ─────────────────────────────────────────────────────────────

export async function createTicket(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const title = str(formData.get('title'))
  if (!title) return { error: 'Title is required.' }

  const admin = createAdminClient()
  const assignedTo = str(formData.get('assigned_to'))

  const { data: ticket, error } = await admin.from('repair_tickets').insert({
    company_id:    profile.company_id,
    asset_id:      str(formData.get('asset_id')),
    created_by:    profile.id,
    assigned_to:   assignedTo,
    title,
    description:   str(formData.get('description')),
    source:        str(formData.get('source')) ?? 'manual',
    priority:      str(formData.get('priority')) ?? 'normal',
    safety_status: str(formData.get('safety_status')) ?? 'none',
    status:        assignedTo ? 'assigned' : 'new',
    parts_needed:  bool(formData.get('parts_needed')),
    parts_notes:   str(formData.get('parts_notes')),
  }).select('id').single()

  if (error) return { error: error.message }

  // Record assignment history if assigned
  if (assignedTo && ticket) {
    await admin.from('repair_ticket_assignments').insert({
      ticket_id:   ticket.id,
      profile_id:  assignedTo,
      assigned_by: profile.id,
    })
  }

  revalidatePath('/tickets')
  redirect(`/tickets/${ticket!.id}`)
}

// ── Update ticket ─────────────────────────────────────────────────────────────

export async function updateTicket(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    return { error: 'You do not have permission to edit tickets.' }
  }

  const title = str(formData.get('title'))
  if (!title) return { error: 'Title is required.' }

  const admin = createAdminClient()
  const { error } = await admin.from('repair_tickets').update({
    asset_id:      str(formData.get('asset_id')),
    assigned_to:   str(formData.get('assigned_to')),
    title,
    description:   str(formData.get('description')),
    source:        str(formData.get('source')) ?? 'manual',
    priority:      str(formData.get('priority')) ?? 'normal',
    safety_status: str(formData.get('safety_status')) ?? 'none',
    parts_needed:  bool(formData.get('parts_needed')),
    parts_ordered: bool(formData.get('parts_ordered')),
    waiting_on_parts: bool(formData.get('waiting_on_parts')),
    parts_notes:   str(formData.get('parts_notes')),
    vendor:        str(formData.get('vendor')),
  }).eq('id', id).eq('company_id', profile.company_id)

  if (error) return { error: error.message }

  revalidatePath('/tickets')
  revalidatePath(`/tickets/${id}`)
  redirect(`/tickets/${id}`)
}

// ── Change status ─────────────────────────────────────────────────────────────

export async function changeTicketStatus(id: string, nextStatus: string) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()
  const updates: Record<string, unknown> = { status: nextStatus }

  if (nextStatus === 'completed') {
    updates.date_completed = new Date().toISOString().split('T')[0]
    updates.completed_by = profile.id
  }

  await admin.from('repair_tickets').update(updates)
    .eq('id', id)
    .eq('company_id', profile.company_id)

  revalidatePath(`/tickets/${id}`)
  revalidatePath('/tickets')
}

// ── Assign ticket ─────────────────────────────────────────────────────────────

export async function assignTicket(id: string, assigneeId: string) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()

  // Deactivate old assignments
  await admin.from('repair_ticket_assignments')
    .update({ is_active: false })
    .eq('ticket_id', id)

  if (assigneeId) {
    await admin.from('repair_ticket_assignments').insert({
      ticket_id: id, profile_id: assigneeId, assigned_by: profile.id,
    })
    await admin.from('repair_tickets').update({ assigned_to: assigneeId, status: 'assigned' })
      .eq('id', id).eq('company_id', profile.company_id)
  } else {
    await admin.from('repair_tickets').update({ assigned_to: null })
      .eq('id', id).eq('company_id', profile.company_id)
  }

  revalidatePath(`/tickets/${id}`)
}

// ── Toggle parts flags ────────────────────────────────────────────────────────

export async function togglePartsFlag(
  id: string,
  field: 'parts_needed' | 'parts_ordered' | 'waiting_on_parts',
  value: boolean
) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()
  const updates: Record<string, unknown> = { [field]: value }
  if (field === 'waiting_on_parts' && value) {
    updates.status = 'waiting_parts'
  }
  if (field === 'waiting_on_parts' && !value) {
    // revert from waiting_parts if it was set
    const { data } = await admin.from('repair_tickets').select('status').eq('id', id).single()
    if (data?.status === 'waiting_parts') updates.status = 'in_progress'
  }

  await admin.from('repair_tickets').update(updates)
    .eq('id', id).eq('company_id', profile.company_id)

  revalidatePath(`/tickets/${id}`)
}

// ── Add comment ───────────────────────────────────────────────────────────────

export async function addComment(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const ticketId = str(formData.get('ticket_id'))
  const comment = str(formData.get('comment'))
  if (!comment) return { error: 'Comment cannot be empty.' }

  const admin = createAdminClient()
  const { error } = await admin.from('repair_ticket_comments').insert({
    ticket_id:   ticketId,
    author_id:   profile.id,
    comment,
    is_internal: bool(formData.get('is_internal')),
  })

  if (error) return { error: error.message }

  revalidatePath(`/tickets/${ticketId}`)
  return null
}
