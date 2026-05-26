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
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()
  return data
}

function isManager(role: string) {
  return ['owner', 'manager', 'shop_manager'].includes(role)
}

// ── Approve single entry ──────────────────────────────────────────────────────

export async function approveTimeEntry(entryId: string) {
  const profile = await getProfile()
  if (!profile || !isManager(profile.role)) return

  const admin = createAdminClient()
  await admin.from('time_clock_entries').update({
    is_approved: true,
    approved_by: profile.id,
    approved_at: new Date().toISOString(),
  }).eq('id', entryId)

  revalidatePath('/time')
  revalidatePath('/time/approvals')
  revalidatePath('/reports/payroll')
}

// ── Unapprove ─────────────────────────────────────────────────────────────────

export async function unapproveTimeEntry(entryId: string) {
  const profile = await getProfile()
  if (!profile || !isManager(profile.role)) return

  const admin = createAdminClient()
  await admin.from('time_clock_entries').update({
    is_approved: false,
    approved_by: null,
    approved_at: null,
  }).eq('id', entryId)

  revalidatePath('/time')
  revalidatePath('/time/approvals')
  revalidatePath('/reports/payroll')
}

// ── Bulk approve by date range ────────────────────────────────────────────────

export async function bulkApprove(start: string, end: string) {
  const profile = await getProfile()
  if (!profile || !isManager(profile.role)) return

  const admin = createAdminClient()
  await admin.from('time_clock_entries')
    .update({
      is_approved: true,
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id)
    .gte('clock_in', new Date(start).toISOString())
    .lte('clock_in', new Date(end + 'T23:59:59').toISOString())
    .eq('is_approved', false)
    .not('clock_out', 'is', null) // only close entries

  revalidatePath('/time')
  revalidatePath('/time/approvals')
  revalidatePath('/reports/payroll')
}

// ── Manual adjust entry ───────────────────────────────────────────────────────

export async function adjustTimeEntry(
  entryId: string,
  clockIn: string,
  clockOut: string,
  note: string
) {
  const profile = await getProfile()
  if (!profile || !isManager(profile.role)) return

  const admin = createAdminClient()
  const inDate  = new Date(clockIn)
  const outDate = new Date(clockOut)
  const totalMins = Math.round((outDate.getTime() - inDate.getTime()) / 60000)

  await admin.from('time_clock_entries').update({
    clock_in: inDate.toISOString(),
    clock_out: outDate.toISOString(),
    total_minutes: totalMins,
    manually_adjusted: true,
    adjusted_by: profile.id,
    adjustment_note: note,
  }).eq('id', entryId)

  revalidatePath('/time')
  revalidatePath('/reports/payroll')
}
