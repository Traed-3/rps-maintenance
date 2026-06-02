'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

type Asset    = { id: string; unit_number: string; name: string | null; make: string | null; model: string | null }
type Employee = { id: string; full_name: string; role: string }

type Ticket = {
  id: string
  asset_id: string | null
  assigned_to: string | null
  title: string
  description: string | null
  source: string
  priority: string
  safety_status: string
  status: string
  parts_needed: boolean
  parts_ordered: boolean
  waiting_on_parts: boolean
  parts_notes: string | null
  vendor: string | null
}

export function TicketForm({
  action,
  assets,
  employees,
  ticket,
  currentAssigneeIds = [],
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  assets: Asset[]
  employees: Employee[]
  ticket?: Ticket
  currentAssigneeIds?: string[]
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [selected, setSelected] = useState<Set<string>>(new Set(currentAssigneeIds))
  const t = ticket

  function toggleEmployee(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {/* Core info */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Ticket Info</h2>
        <div className="space-y-4">
          <div>
            <label className={lbl}>Title <span className="text-red-500">*</span></label>
            <input name="title" className={inp} placeholder="Brief description of the issue" defaultValue={t?.title ?? ''} required />
          </div>
          <div>
            <label className={lbl}>Description</label>
            <textarea name="description" rows={3} className={inp} placeholder="Full details — what's wrong, when it started, what was noticed…" defaultValue={t?.description ?? ''} />
          </div>
        </div>
      </section>

      {/* Asset + assignment */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Asset &amp; Assignment</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Asset</label>
            <select name="asset_id" className={inp} defaultValue={t?.asset_id ?? ''}>
              <option value="">— No asset —</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.unit_number}{[a.make, a.model].filter(Boolean).length ? ` — ${[a.make, a.model].filter(Boolean).join(' ')}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>
              Assign To
              <span className="ml-1.5 text-xs font-normal text-gray-400">
                — select one or more
              </span>
            </label>
            {/* Hidden inputs carry the selected IDs */}
            {Array.from(selected).map(id => (
              <input key={id} type="hidden" name="assigned_to" value={id} />
            ))}
            <div className="rounded-lg border border-gray-300 divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {employees.length === 0 && (
                <p className="px-3 py-2 text-sm text-gray-400">No employees found.</p>
              )}
              {employees.map((e) => (
                <label
                  key={e.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selected.has(e.id) ? 'bg-blue-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={() => toggleEmployee(e.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{e.full_name}</p>
                    <p className="text-xs text-gray-400 capitalize">{e.role.replace(/_/g, ' ')}</p>
                  </div>
                </label>
              ))}
            </div>
            {selected.size > 0 && (
              <p className="text-xs text-blue-600 mt-1 font-medium">
                {selected.size} employee{selected.size !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Priority + classification */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Priority &amp; Classification</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>Priority</label>
            <select name="priority" className={inp} defaultValue={t?.priority ?? 'normal'}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
              <option value="safety">Safety</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Source</label>
            <select name="source" className={inp} defaultValue={t?.source ?? 'manual'}>
              <option value="manual">Manual Entry</option>
              <option value="employee">Employee Report</option>
              <option value="manager">Manager</option>
              <option value="inspection">Inspection</option>
              <option value="preventive">Preventive</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Safety Status</label>
            <select name="safety_status" className={inp} defaultValue={t?.safety_status ?? 'none'}>
              <option value="none">None</option>
              <option value="monitor">Monitor</option>
              <option value="needs_inspection">Needs Inspection</option>
              <option value="schedule_soon">Schedule Soon</option>
              <option value="unsafe">Unsafe — Do Not Use</option>
            </select>
          </div>
        </div>
      </section>

      {/* Parts */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Parts</h2>
        <div className="flex flex-wrap gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" name="parts_needed"     defaultChecked={t?.parts_needed}     className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            Parts Needed
          </label>
          {t && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" name="parts_ordered"     defaultChecked={t?.parts_ordered}     className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                Parts Ordered
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" name="waiting_on_parts"  defaultChecked={t?.waiting_on_parts}  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                Waiting on Parts
              </label>
            </>
          )}
        </div>
        <div>
          <label className={lbl}>Parts Notes</label>
          <input name="parts_notes" className={inp} placeholder="Part numbers, descriptions, supplier…" defaultValue={t?.parts_notes ?? ''} />
        </div>
      </section>

      {/* Vendor */}
      {t && (
        <section>
          <label className={lbl}>Vendor / Shop</label>
          <input name="vendor" className={inp} placeholder="External shop if applicable" defaultValue={t?.vendor ?? ''} />
        </section>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : t ? 'Save Changes' : 'Create Ticket'}
        </Button>
        <a href="/tickets" className="text-sm text-gray-500 hover:text-gray-700">Cancel</a>
      </div>
    </form>
  )
}
