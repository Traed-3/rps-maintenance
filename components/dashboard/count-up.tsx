'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Counts up to a numeric value on mount (easeOutCubic). Preserves a trailing
 * suffix like "h" (e.g. "5.0h") and decimal places. Non-numeric values render
 * as-is, so it's safe to wrap any StatCard value.
 */
export function CountUp({ value, className }: { value: string | number; className?: string }) {
  const str = String(value)
  const m = str.match(/^(\d[\d,]*\.?\d*)(.*)$/)
  const target = m ? parseFloat(m[1].replace(/,/g, '')) : NaN
  const suffix = m ? m[2] : ''
  const decimals = m && m[1].includes('.') ? (m[1].split('.')[1]?.length ?? 0) : 0

  const [display, setDisplay] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    if (isNaN(target) || started.current) return
    started.current = true
    const duration = 750
    let raf = 0
    let startTime = 0
    const tick = (now: number) => {
      if (!startTime) startTime = now
      const p = Math.min(1, (now - startTime) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(target * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])

  if (isNaN(target)) return <span className={className}>{str}</span>

  const formatted = display.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return <span className={className}>{formatted}{suffix}</span>
}
