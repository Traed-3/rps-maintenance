import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

type Color = 'blue' | 'red' | 'orange' | 'yellow' | 'green' | 'gray' | 'purple'

const COLOR_MAP: Record<Color, { bg: string; icon: string; border: string; text: string }> = {
  blue:   { bg: 'bg-blue-50',   icon: 'text-blue-600',   border: 'border-blue-100',   text: 'text-blue-900' },
  red:    { bg: 'bg-red-50',    icon: 'text-red-600',    border: 'border-red-100',    text: 'text-red-900' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-600', border: 'border-orange-100', text: 'text-orange-900' },
  yellow: { bg: 'bg-yellow-50', icon: 'text-yellow-600', border: 'border-yellow-100', text: 'text-yellow-900' },
  green:  { bg: 'bg-green-50',  icon: 'text-green-600',  border: 'border-green-100',  text: 'text-green-900' },
  gray:   { bg: 'bg-gray-50',   icon: 'text-gray-500',   border: 'border-gray-200',   text: 'text-gray-900' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600', border: 'border-purple-100', text: 'text-purple-900' },
}

export function StatCard({
  label,
  value,
  icon: Icon,
  color = 'blue',
  href,
  alert = false,
}: {
  label: string
  value: string | number
  icon: LucideIcon
  color?: Color
  href?: string
  alert?: boolean
}) {
  const c = COLOR_MAP[color]
  const content = (
    <div className={cn(
      'rounded-2xl border p-5 flex items-center gap-4 shadow-sm transition-all duration-200',
      c.bg, c.border,
      href && 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer',
      alert && Number(value) > 0 && 'ring-2 ring-red-300'
    )}>
      <div className={cn('p-2.5 rounded-xl bg-white shadow-sm', c.border, 'border')}>
        <Icon className={cn('w-5 h-5', c.icon)} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-900 tabular-nums tracking-tight">{value}</p>
        <p className={cn('text-xs font-medium mt-0.5', c.text)}>{label}</p>
      </div>
    </div>
  )

  if (href) return <Link href={href}>{content}</Link>
  return content
}
