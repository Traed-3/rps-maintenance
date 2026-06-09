'use client'

import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * A non-table row/card whose entire surface navigates to `href` on click (and Enter).
 * Like ClickableRow but renders a <div>, for flex/list rows. Clicks on nested
 * interactive elements (links, buttons, inputs) and text selection are ignored,
 * so per-row action links/buttons keep working.
 */
export function ClickableItem({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  const router = useRouter()

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.closest('a, button, input, select, textarea, label, [role="button"], [data-no-row-nav]')) return
    if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
    router.push(href)
  }

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          router.push(href)
        }
      }}
      role="link"
      tabIndex={0}
      className={cn(
        'cursor-pointer hover:bg-gray-50 transition-colors focus:outline-none focus:bg-gray-50',
        className,
      )}
    >
      {children}
    </div>
  )
}
