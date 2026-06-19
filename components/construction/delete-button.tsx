'use client'

import { useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Confirm-then-run delete button. `action` is a bound server action that takes
 * no arguments (bind the id in the server component before passing it down).
 */
export function DeleteButton({
  action,
  confirm = 'Delete this record? This cannot be undone.',
  label = 'Delete',
  className,
  iconOnly = false,
}: {
  action: () => Promise<void>
  confirm?: string
  label?: string
  className?: string
  iconOnly?: boolean
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      data-no-row-nav
      disabled={isPending}
      onClick={() => {
        if (window.confirm(confirm)) startTransition(() => { action() })
      }}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50',
        className,
      )}
    >
      <Trash2 className="w-3.5 h-3.5" />
      {!iconOnly && (isPending ? 'Deleting…' : label)}
    </button>
  )
}
