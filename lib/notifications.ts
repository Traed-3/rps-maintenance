/**
 * In-app notification helpers.
 * All notifications are inserted into the notifications table.
 * Deduplication: skip if same type + entity was notified in the last 20 hours.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { calcDateDue, calcOilChangeDue } from '@/lib/maintenance'

type AdminClient = ReturnType<typeof createAdminClient>

// ── Low-level insert with dedup ───────────────────────────────────────────────

async function notify(
  admin: AdminClient,
  {
    companyId,
    recipientId,
    type,
    title,
    message,
    link,
    relatedAssetId,
    relatedTicketId,
    dedupAssetId,
  }: {
    companyId: string
    recipientId?: string | null
    type: string
    title: string
    message?: string
    link?: string
    relatedAssetId?: string | null
    relatedTicketId?: string | null
    dedupAssetId?: string  // skip if this asset+type notified recently
  }
) {
  // Dedup: don't re-notify for the same asset + type within 20 hours
  if (dedupAssetId) {
    const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('company_id', companyId)
      .eq('type', type)
      .eq('related_asset_id', dedupAssetId)
      .gte('created_at', cutoff)
      .limit(1)
      .maybeSingle()

    if (existing) return
  }

  await admin.from('notifications').insert({
    company_id:        companyId,
    recipient_id:      recipientId ?? null,
    type,
    title,
    message:           message ?? null,
    link:              link ?? null,
    related_asset_id:  relatedAssetId ?? null,
    related_ticket_id: relatedTicketId ?? null,
  })
}

// ── Rule: overdue maintenance ─────────────────────────────────────────────────
// Called from dashboard load. Creates one notification per overdue asset.

export async function checkOverdueMaintenanceNotifications(
  admin: AdminClient,
  companyId: string
) {
  const { data: assets } = await admin
    .from('assets')
    .select(`id, unit_number, status,
      current_mileage, next_oil_change_mileage,
      next_brake_inspection_date, next_tire_inspection_date,
      inspection_due_date,
      registration_due_date, insurance_due_date`)
    .eq('company_id', companyId)
    .not('status', 'in', '(retired,down,unsafe)')

  for (const a of assets ?? []) {
    const checks = [
      { r: calcOilChangeDue(a.current_mileage, a.next_oil_change_mileage), label: 'Oil Change' },
      { r: calcDateDue(a.next_brake_inspection_date),   label: 'Brake Inspection' },
      { r: calcDateDue(a.next_tire_inspection_date),    label: 'Tire Inspection' },
      { r: calcDateDue(a.inspection_due_date),          label: 'State Inspection' },
      { r: calcDateDue(a.registration_due_date),        label: 'Registration' },
      { r: calcDateDue(a.insurance_due_date),           label: 'Insurance' },
    ]

    for (const { r, label } of checks) {
      if (r.status === 'overdue' || r.status === 'due_today') {
        await notify(admin, {
          companyId,
          type:           'maintenance_overdue',
          title:          `${label} overdue — ${a.unit_number}`,
          message:        r.label,
          link:           `/assets/${a.id}`,
          relatedAssetId: a.id,
          dedupAssetId:   `${a.id}_${label}`,  // unique per asset+type
        })
      }
    }
  }
}

// ── Rule: unsafe / down asset ─────────────────────────────────────────────────
// Called from updateAsset when status changes to unsafe or down.

export async function notifyAssetUnsafe(
  admin: AdminClient,
  companyId: string,
  assetId: string,
  unitNumber: string,
  newStatus: string
) {
  await notify(admin, {
    companyId,
    type:           'asset_unsafe',
    title:          `${unitNumber} marked ${newStatus.toUpperCase()}`,
    message:        `${unitNumber} has been set to "${newStatus}" and may need immediate attention.`,
    link:           `/assets/${assetId}`,
    relatedAssetId: assetId,
    dedupAssetId:   assetId,
  })
}

// ── Rule: forgot to clock out ─────────────────────────────────────────────────
// Called from dashboard. Notifies if employee has been clocked in > 10 hours.

export async function checkForgotClockOut(
  admin: AdminClient,
  companyId: string
) {
  const cutoff = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()

  const { data: staleEntries } = await admin
    .from('time_clock_entries')
    .select('id, profile_id, clock_in, profiles(full_name)')
    .eq('company_id', companyId)
    .is('clock_out', null)
    .lte('clock_in', cutoff)

  for (const e of staleEntries ?? []) {
    const name = (e as any).profiles?.full_name ?? 'An employee'
    const hoursAgo = Math.floor((Date.now() - new Date(e.clock_in).getTime()) / 3600000)

    // Dedup by profile + type (one per day per employee)
    const yesterday = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('company_id', companyId)
      .eq('type', 'clock_out_reminder')
      .eq('recipient_id', e.profile_id)
      .gte('created_at', yesterday)
      .maybeSingle()

    if (existing) continue

    await admin.from('notifications').insert({
      company_id:   companyId,
      recipient_id: e.profile_id,
      type:         'clock_out_reminder',
      title:        `${name} may have forgotten to clock out`,
      message:      `Clocked in ${hoursAgo}+ hours ago with no clock-out recorded.`,
      link:         `/shop/employees/${e.profile_id}`,
    })
  }
}
