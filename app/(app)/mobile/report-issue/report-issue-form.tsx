'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null
type Asset = { id: string; unit_number: string; name: string | null; make: string | null; model: string | null; year: number | null }

const inp = 'w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1.5'

export function ReportIssueForm({
  action,
  assets,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  assets: Asset[]
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-5">
      {/* Hidden fields for defaults */}
      <input type="hidden" name="source" value="employee" />

      {state?.error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div>
        <label className={lbl}>What&apos;s the issue? <span className="text-red-500">*</span></label>
        <input
          name="title"
          className={inp}
          placeholder="Brief description"
          required
          autoFocus
        />
      </div>

      <div>
        <label className={lbl}>Which vehicle or equipment?</label>
        <select name="asset_id" className={inp}>
          <option value="">— No specific vehicle —</option>
          {assets.map(a => (
            <option key={a.id} value={a.id}>
              {a.unit_number}{[a.year, a.make, a.model].filter(Boolean).length
                ? ` — ${[a.year, a.make, a.model].filter(Boolean).join(' ')}`
                : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={lbl}>How urgent is it?</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'normal',   label: '🟡 Normal',    desc: 'Not urgent' },
            { value: 'high',     label: '🟠 High',      desc: 'Needs attention soon' },
            { value: 'critical', label: '🔴 Critical',  desc: 'Stop what you\'re doing' },
            { value: 'safety',   label: '⚠️ Safety',    desc: 'Do not use vehicle' },
          ].map(p => (
            <label key={p.value} className="cursor-pointer">
              <input type="radio" name="priority" value={p.value} defaultChecked={p.value === 'normal'} className="sr-only peer" />
              <div className="peer-checked:border-blue-500 peer-checked:bg-blue-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm hover:border-gray-400 transition-colors">
                <p className="font-semibold">{p.label}</p>
                <p className="text-xs text-gray-500">{p.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className={lbl}>Details (optional)</label>
        <textarea
          name="description"
          rows={3}
          className={inp}
          placeholder="What did you notice? When did it start? Any other details…"
        />
      </div>

      {/* Safety flag */}
      <div>
        <label className={lbl}>Is it safe to use?</label>
        <select name="safety_status" className={inp}>
          <option value="none">Yes, it&apos;s fine to use</option>
          <option value="monitor">Needs monitoring</option>
          <option value="needs_inspection">Needs inspection first</option>
          <option value="schedule_soon">Schedule repair soon</option>
          <option value="unsafe">No — DO NOT USE</option>
        </select>
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? 'Submitting…' : 'Submit Report'}
      </Button>
    </form>
  )
}
