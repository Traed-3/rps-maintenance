import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Users, Building2, CreditCard, BookOpen } from 'lucide-react'

const LINKS = [
  { href: '/settings/users',           icon: Users,       title: 'User Management',    desc: 'Change employee roles, activate or deactivate accounts.' },
  { href: '/settings/company',         icon: Building2,   title: 'Company Settings',   desc: 'Update company name and timezone.' },
  { href: '/settings/payment-methods', icon: CreditCard,  title: 'Payment Methods',    desc: 'Manage expense payment codes (TEC, HDP, CASH, custom).' },
  { href: '/settings/guide',           icon: BookOpen,    title: 'User Guide',         desc: 'Instructions for the owner and shop employees.' },
]

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user!.id).single()

  if (!['owner', 'manager'].includes(profile?.role ?? '')) {
    redirect('/dashboard')
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your RPS platform.</p>
      </div>

      <div className="space-y-3">
        {LINKS.map(l => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 hover:shadow-sm transition-all"
          >
            <div className="p-2.5 rounded-lg bg-gray-100 border border-gray-200">
              <l.icon className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">{l.title}</p>
              <p className="text-sm text-gray-500 mt-0.5">{l.desc}</p>
            </div>
            <span className="ml-auto text-gray-400">→</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
