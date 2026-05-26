import { cn } from '@/lib/utils'
import { DUE_BADGE, type DueStatus } from '@/lib/maintenance'

export function DueBadge({ status, label }: { status: DueStatus; label?: string }) {
  const cfg = DUE_BADGE[status]
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border', cfg.className)}>
      {label ?? cfg.label}
    </span>
  )
}
