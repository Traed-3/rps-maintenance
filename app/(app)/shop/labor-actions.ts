'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('id, company_id')
    .eq('id', user.id)
    .single()
  return data
}

// Helper: sum all labor entries for a ticket and update total_labor_hours
async function syncTicketLaborHours(admin: ReturnType<typeof createAdminClient>, ticketId: string) {
  const { data: entries } = await admin
    .from('labor_entries')
    .select('total_minutes')
    .eq('ticket_id', ticketId)
    .eq('entry_type', 'ticket')

  const totalMins = (entries ?? []).reduce((sum, e) => sum + (e.total_minutes ?? 0), 0)
  const totalHours = Math.round((totalMins / 60) * 100) / 100

  await admin
    .from('repair_tickets')
    .update({ total_labor_hours: totalHours })
    .eq('id', ticketId)
}

// Helper: close any currently active labor entry for this employee
async function closeActiveLaborEntry(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  note?: string
) {
  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('active_labor_entry_id')
    .eq('profile_id', profileId)
    .single()

  if (!empStatus?.active_labor_entry_id) return null

  const { data: entry } = await admin
    .from('labor_entries')
    .select('id, started_at, ticket_id')
    .eq('id', empStatus.active_labor_entry_id)
    .single()

  if (!entry) return null

  const now = new Date()
  const totalMins = Math.round((now.getTime() - new Date(entry.started_at).getTime()) / 60000)

  await admin.from('labor_entries').update({
    ended_at: now.toISOString(),
    total_minutes: totalMins,
    is_active: false,
    ...(note ? { notes: note } : {}),
  }).eq('id', entry.id)

  // Sync ticket hours if this was a ticket entry
  if (entry.ticket_id) {
    await syncTicketLaborHours(admin, entry.ticket_id)
  }

  return entry
}

// ── Start Work on Ticket ───────────────────────────────────────────────────────

export async function startWork(ticketId: string) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()

  // Auto-close any currently active labor entry
  await closeActiveLaborEntry(admin, profile.id, 'Auto-paused when starting new task')

  // Get current open clock entry id (if any)
  const { data: clockEntry } = await admin
    .from('time_clock_entries')
    .select('id')
    .eq('profile_id', profile.id)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Create new labor entry
  const { data: newEntry } = await admin.from('labor_entries').insert({
    company_id: profile.company_id,
    profile_id: profile.id,
    ticket_id: ticketId,
    time_clock_entry_id: clockEntry?.id ?? null,
    entry_type: 'ticket',
    started_at: new Date().toISOString(),
    is_active: true,
  }).select('id').single()

  // Upsert employee status
  await admin.from('employee_statuses').upsert(
    {
      profile_id: profile.id,
      company_id: profile.company_id,
      clock_status: 'clocked_in',
      current_status: 'working_on_ticket',
      current_ticket_id: ticketId,
      active_labor_entry_id: newEntry?.id ?? null,
      status_updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' }
  )

  // Move ticket to in_progress if it was assigned/new/open
  const { data: ticket } = await admin
    .from('repair_tickets')
    .select('status')
    .eq('id', ticketId)
    .single()

  if (ticket && ['new', 'open', 'assigned', 'paused'].includes(ticket.status)) {
    await admin.from('repair_tickets')
      .update({ status: 'in_progress' })
      .eq('id', ticketId)
  }

  revalidatePath(`/tickets/${ticketId}`)
  revalidatePath('/shop')
}

// ── Pause Work ─────────────────────────────────────────────────────────────────

export async function pauseWork(ticketId: string) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()
  await closeActiveLaborEntry(admin, profile.id)

  // Update employee status — keep ticket assigned, just not actively working
  await admin.from('employee_statuses').upsert(
    {
      profile_id: profile.id,
      company_id: profile.company_id,
      current_status: 'at_shop',
      active_labor_entry_id: null,
      status_updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' }
  )

  // Move ticket to paused
  await admin.from('repair_tickets')
    .update({ status: 'paused' })
    .eq('id', ticketId)

  revalidatePath(`/tickets/${ticketId}`)
  revalidatePath('/shop')
}

// ── Stop Work (done with ticket for now) ──────────────────────────────────────

export async function stopWork(ticketId: string) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()
  await closeActiveLaborEntry(admin, profile.id)

  // Clear current ticket from employee status
  await admin.from('employee_statuses').upsert(
    {
      profile_id: profile.id,
      company_id: profile.company_id,
      current_status: 'at_shop',
      current_ticket_id: null,
      active_labor_entry_id: null,
      status_updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' }
  )

  revalidatePath(`/tickets/${ticketId}`)
  revalidatePath('/shop')
}

// ── Log General Shop Time ──────────────────────────────────────────────────────

export async function logGeneralTime(
  _state: { error: string } | null,
  formData: FormData
): Promise<{ error: string } | null> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const admin = createAdminClient()
  const durationMins = parseInt(formData.get('duration_minutes') as string, 10)
  if (!durationMins || durationMins <= 0) return { error: 'Please enter a valid duration.' }

  const entryType = (formData.get('entry_type') as string) || 'general_shop'
  const description = ((formData.get('description') as string) || '').trim() || null

  const now = new Date()
  const startedAt = new Date(now.getTime() - durationMins * 60000)

  // Get current open clock entry
  const { data: clockEntry } = await admin
    .from('time_clock_entries')
    .select('id')
    .eq('profile_id', profile.id)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await admin.from('labor_entries').insert({
    company_id: profile.company_id,
    profile_id: profile.id,
    ticket_id: null,
    time_clock_entry_id: clockEntry?.id ?? null,
    entry_type: entryType,
    started_at: startedAt.toISOString(),
    ended_at: now.toISOString(),
    total_minutes: durationMins,
    description,
    is_active: false,
  })

  if (error) return { error: error.message }

  revalidatePath('/shop')
  revalidatePath('/shop/general-time')
  return null
}
