'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export type CustomerRecord = {
  id: string
  name: string
  billing_contact: string | null
  email: string | null
  phone: string | null
  billing_address: string | null
  notes: string | null
}

export function CustomerForm({
  action,
  customer,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  customer?: CustomerRecord
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const c = customer

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      <div>
        <label className={lbl}>Customer Name <span className="text-red-500">*</span></label>
        <input name="name" className={inp} placeholder="e.g. JF Petroleum Group" defaultValue={c?.name ?? ''} required />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Billing Contact</label>
          <input name="billing_contact" className={inp} defaultValue={c?.billing_contact ?? ''} />
        </div>
        <div>
          <label className={lbl}>Phone</label>
          <input name="phone" className={inp} defaultValue={c?.phone ?? ''} />
        </div>
      </div>

      <div>
        <label className={lbl}>Email</label>
        <input name="email" type="email" className={inp} defaultValue={c?.email ?? ''} />
      </div>

      <div>
        <label className={lbl}>Billing Address</label>
        <textarea name="billing_address" rows={2} className={inp} defaultValue={c?.billing_address ?? ''} />
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={3} className={inp} defaultValue={c?.notes ?? ''} />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : c ? 'Save Changes' : 'Add Customer'}</Button>
        <a href="/construction/customers" className="text-sm text-gray-500 hover:text-gray-700">Cancel</a>
      </div>
    </form>
  )
}
