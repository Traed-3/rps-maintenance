'use client'

import { useTransition } from 'react'
import { CON_STAGES, stageMeta } from '@/lib/construction'

/** Inline stage dropdown that saves immediately. */
export function StageSelect({
  jobId,
  stage,
  action,
}: {
  jobId: string
  stage: string
  action: (id: string, stage: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  const c = stageMeta(stage)

  return (
    <select
      data-no-row-nav
      disabled={isPending}
      value={stage}
      onChange={(e) => startTransition(() => { action(jobId, e.target.value) })}
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 ${c.className}`}
    >
      {CON_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  )
}
