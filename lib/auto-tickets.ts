/**
 * Auto-creates repair tickets for overdue maintenance items.
 * Called from the dashboard. Skips if an open ticket already exists
 * for the same asset + maintenance type.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { calcDateDue, calcOilChangeDue } from '@/lib/maintenance'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Treat date-based maintenance that is MORE THAN 60 DAYS overdue as completed:
 * the asset is on the road, so an annual item that far past due was actually done
 * but never logged. Roll the due date forward to the next future cycle and mark
 * any open reminder ticket done. Keeps the "maintenance due" list reflecting reality.
 */
export async function rollStaleOverdueMaintenance(admin: AdminClient, companyId: string) {
  const now = new Date()
  const today  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const cutoff = new Date(today); cutoff.setUTCDate(cutoff.getUTCDate() - 60)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const fields: { col: string; ticketTitle: string | null }[] = [
    { col: 'inspection_due_date',        ticketTitle: 'State Inspection' },
    { col: 'registration_due_date',      ticketTitle: 'Registration' },
    { col: 'next_brake_inspection_date', ticketTitle: null },
    { col: 'next_tire_inspection_date',  ticketTitle: null },
  ]

  for (const f of fields) {
    const { data: rows } = await admin
      .from('assets')
      .select(`id, ${f.col}`)
      .eq('company_id', companyId)
      .neq('status', 'retired')
      .not(f.col, 'is', null)
      .lt(f.col, cutoffStr)

    for (const r of (rows ?? []) as any[]) {
      const oldStr = r[f.col] as string
      const due = new Date(oldStr + 'T00:00:00Z')
      const m = due.getUTCMonth(), d = due.getUTCDate()
      let next = new Date(Date.UTC(today.getUTCFullYear(), m, d))
      if (next <= today) next = new Date(Date.UTC(today.getUTCFullYear() + 1, m, d))
      const newStr = next.toISOString().split('T')[0]

      await admin.from('assets').update({ [f.col]: newStr }).eq('id', r.id)

      if (f.ticketTitle) {
        await admin.from('repair_tickets')
          .update({
            status: 'completed',
            date_completed: oldStr,
            completion_notes: `${f.ticketTitle} assumed complete (was >60 days overdue).`,
          })
          .eq('asset_id', r.id).eq('company_id', companyId)
          .ilike('title', `${f.ticketTitle}%`)
          .not('status', 'in', '(closed,completed,deferred)')
      }
    }
  }
}

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
      registration_due_date,
      auto_ticket_inspection, auto_ticket_registration, auto_ticket_oil_change`)
    .eq('company_id', companyId)
    .not('status', 'in', '(retired,down,unsafe)')

  for (const asset of assets ?? []) {
    const overdueItems: { label: string; priority: string }[] = []

    const oil = calcOilChangeDue(asset.current_mileage, asset.next_oil_change_mileage)
    if (oil.status === 'overdue' && (asset as any).auto_ticket_oil_change !== false) {
      overdueItems.push({ label: 'Oil Change', priority: 'normal' })
    }

    // Per-asset toggles control which due-date types auto-create tickets
    const dateChecks = [
      { r: calcDateDue(asset.next_brake_inspection_date),  label: 'Brake Inspection', priority: 'high',   enabled: true },
      { r: calcDateDue(asset.next_tire_inspection_date),   label: 'Tire Inspection',  priority: 'normal', enabled: true },
      { r: calcDateDue(asset.inspection_due_date),         label: 'State Inspection', priority: 'high',   enabled: (asset as any).auto_ticket_inspection   !== false },
      { r: calcDateDue(asset.registration_due_date),       label: 'Registration',     priority: 'normal', enabled: (asset as any).auto_ticket_registration !== false },
    ]

    for (const { r, label, priority, enabled } of dateChecks) {
      if (!enabled) continue
      // Create tickets for anything due within the next 30 days or already overdue
      if (r.status !== 'ok' && r.status !== 'no_data') {
        overdueItems.push({ label, priority })
      }
    }

    for (const item of overdueItems) {
      // Synonyms so we don't duplicate a manually-entered ticket for the same thing
      // (e.g. a manual "Service Due" already covers the auto "Oil Change").
      const SYNONYMS: Record<string, string[]> = {
        'Oil Change':       ['oil change', 'service due', 'service needed', 'ocd'],
        'State Inspection': ['state inspection', 'inspection due', 'needs inspect', 'failed inspection', 'va inspection'],
        'Registration':     ['registration', 'tag due', 'license'],
        'Brake Inspection': ['brake'],
        'Tire Inspection':  ['tire'],
      }
      const patterns = SYNONYMS[item.label] ?? [item.label]

      // Check if an open ticket already exists for this asset + (any synonym of) type
      let existing: { id: string } | null = null
      for (const pat of patterns) {
        const { data } = await admin
          .from('repair_tickets')
          .select('id')
          .eq('asset_id', asset.id)
          .eq('company_id', companyId)
          .ilike('title', `%${pat}%`)
          .not('status', 'in', '(completed,closed,deferred)')
          .limit(1)
          .maybeSingle()
        if (data) { existing = data; break }
      }

      if (existing) continue // already has an open ticket for this (or an equivalent) item

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
