'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * A table row whose entire surface navigates to `href` on click (and Enter).
 * Cells are passed as children so server components can keep rendering them.
 *
 * Prefetches the destination on first hover or touch so iPhone taps land on
 * a page that's already in the router cache — no cold round-trip.
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
  const prefetched = useRef(false)

  function prefetchOnce() {
    if (prefetched.current) return
    prefetched.current = true
    router.prefetch(href)
  }

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
      onPointerEnter={prefetchOnce}   // desktop hover
      onPointerDown={prefetchOnce}    // mobile tap-down — fires before tap-up so the page can start loading
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
