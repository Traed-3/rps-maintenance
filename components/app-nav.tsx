'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Truck,
  Wrench,
  ClipboardList,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Receipt,
  Home,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, active: true },
  { href: '/assets', label: 'Assets', icon: Truck, active: true },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench, active: true },
  { href: '/tickets', label: 'Tickets', icon: ClipboardList, active: true },
  { href: '/shop', label: 'Shop', icon: Users, active: true },
  { href: '/expenses', label: 'Expenses', icon: Receipt, active: true },
  { href: '/reports', label: 'Reports', icon: BarChart3, active: true },
  { href: '/settings', label: 'Settings', icon: Settings, active: true },
]

export default function AppNav({ email, role }: { email: string; role?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = ['owner', 'manager'].includes(role ?? '')

  // Mobile bottom-bar items — owners/managers get Settings so they can reach
  // user management, company info, alerts, etc. from a phone or the iPad app.
  const mobileItems = [
    { href: '/mobile',    label: 'Home',      icon: Home },
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/assets',    label: 'Assets',    icon: Truck },
    { href: '/tickets',   label: 'Tickets',   icon: ClipboardList },
    { href: '/shop',      label: 'Shop',      icon: Users },
    ...(isAdmin ? [{ href: '/settings', label: 'Settings', icon: Settings }] : []),
  ]

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col bg-white border-r border-gray-200 min-h-screen">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-gray-200">
          <Image
            src="/logo-full.png"
            alt="RPS Intelligence"
            width={220}
            height={100}
            priority
            className="h-14 w-auto"
          />
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return item.active ? (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                  isActive
                    ? 'bg-gradient-to-r from-[#16243d] to-[#2d4e7a] text-white shadow-md shadow-blue-900/20'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            ) : (
              <div
                key={item.href}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 cursor-not-allowed"
                title="Coming soon"
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </div>
            )
          })}
        </nav>

        {/* User / sign out */}
        <div className="px-3 py-4 border-t border-gray-200">
          <p className="px-3 text-xs text-gray-400 truncate mb-1">{email}</p>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50">
        {mobileItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/mobile' && pathname.startsWith(item.href + '/'))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors',
                isActive ? 'text-blue-600' : 'text-gray-500'
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
