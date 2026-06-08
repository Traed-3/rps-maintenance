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

  function go() {
    router.push(href)
  }

  return (
    <tr
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go()
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
