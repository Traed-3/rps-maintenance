'use client'

import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * A table row whose entire surface navigates to `href` on click (and Enter).
 * Cells are passed as children so server components can keep rendering them.
 */
export function ClickableRow({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  const router = useRouter()

  function handleClick(e: React.MouseEvent<HTMLTableRowElement>) {
    // Don't hijack clicks on nested interactive elements (links, buttons, inputs, etc.)
    const target = e.target as HTMLElement
    if (target.closest('a, button, input, select, textarea, label, [role="button"], [data-no-row-nav]')) return
    // Don't navigate if the user is selecting text
    if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
    router.push(href)
  }

  return (
    <tr
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
    </tr>
  )
}
