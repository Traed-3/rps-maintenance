/**
 * Auto-creates repair tickets for overdue maintenance items.
 * Called from the dashboard. Skips if an open ticket already exists
 * for the same asset + maintenance type.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { calcDateDue, calcOilChangeDue } from '@/lib/maintenance'

type AdminClient = ReturnType<typeof createAdminClient>

const CHECKS = [
  { key: 'oil',          label: 'Oil Change',        priority: 'normal'  },
  { key: 'brakes',       label: 'Brake Inspection',  priority: 'high'    },
  { key: 'tires',        label: 'Tire Inspection',   priority: 'normal'  },
  { key: 'inspection',   label: 'State Inspection',  priority: 'high'    },
  { key: 'registration', label: 'Registration',      priority: 'normal'  },
]

export async function createOverdueMaintenanceTickets(
  admin: AdminClient,
  companyId: string
) {
  const { data: assets } = await admin
    .from('assets')
    .select(`id, unit_number, current_mileage, next_oil_change_mileage,
      next_brake_inspection_date, next_tire_inspection_date,
      inspection_due_date,
      registration_due_date`)
    .eq('company_id', companyId)
    .not('status', 'in', '(retired,down,unsafe)')

  for (const asset of assets ?? []) {
    const overdueItems: { label: string; priority: string }[] = []

    const oil = calcOilChangeDue(asset.current_mileage, asset.next_oil_change_mileage)
    if (oil.status === 'overdue') overdueItems.push({ label: 'Oil Change', priority: 'normal' })

    const dateChecks = [
      { r: calcDateDue(asset.next_brake_inspection_date),  label: 'Brake Inspection', priority: 'high' },
      { r: calcDateDue(asset.next_tire_inspection_date),   label: 'Tire Inspection',  priority: 'normal' },
      { r: calcDateDue(asset.inspection_due_date),         label: 'State Inspection', priority: 'high' },
      { r: calcDateDue(asset.registration_due_date),       label: 'Registration',     priority: 'normal' },
    ]

    for (const { r, label, priority } of dateChecks) {
      if (r.status === 'overdue' || r.status === 'due_today') {
        overdueItems.push({ label, priority })
      }
    }

    for (const item of overdueItems) {
      // Check if an open ticket already exists for this asset + type
      const { data: existing } = await admin
        .from('repair_tickets')
        .select('id')
        .eq('asset_id', asset.id)
        .eq('company_id', companyId)
        .ilike('title', `%${item.label}%`)
        .not('status', 'in', '(completed,closed,deferred)')
        .limit(1)
        .maybeSingle()

      if (existing) continue // already has an open ticket

      // Create the ticket
      await admin.from('repair_tickets').insert({
        company_id:  companyId,
        asset_id:    asset.id,
        title:       `${item.label} — ${asset.unit_number}`,
        description: `Auto-generated: ${item.label} is overdue for ${asset.unit_number}.`,
        source:      'preventive',
        priority:    item.priority,
        status:      'new',
      })
    }
  }
}
