'use client'

import { useTransition } from 'react'
import { MATERIAL_STATUSES, statusMeta } from '@/lib/construction'

export function MaterialStatusSelect({
  id,
  status,
  action,
}: {
  id: string
  status: string
  action: (id: string, status: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  const c = statusMeta(MATERIAL_STATUSES, status)
  return (
    <select
      data-no-row-nav
      disabled={isPending}
      value={status}
      onChange={(e) => startTransition(() => { action(id, e.target.value) })}
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 ${c.className}`}
    >
      {MATERIAL_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  )
}
