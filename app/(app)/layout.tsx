import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import AppNav from '@/components/app-nav'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { AskRps } from '@/components/assistant/ask-rps'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // Fetch profile; create it on the fly if missing (belt-and-suspenders in
  // case the callback's ensureProfile server action didn't complete)
  let { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    const { data: company } = await admin
      .from('companies').select('id').eq('slug', 'rps').single()
    const fullName =
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.email?.split('@')[0] ??
      'Unknown'
    let role = 'viewer'
    if (company?.id) {
      const { count } = await admin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', company.id)
        .eq('role', 'owner')
      if ((count ?? 0) === 0) role = 'owner'
    }
    const { data: created } = await admin.from('profiles').insert({
      id: user.id,
      company_id: company?.id ?? null,
      full_name: fullName,
      email: user.email!,
      role,
    }).select('id, company_id, role').single()
    profile = created
  }

  // Notifications — skip if we still have no profile (should never happen)
  let filteredNotifications: any[] = []
  if (profile?.company_id) {
    const { data } = await admin
      .from('notifications')
      .select('id, type, title, message, link, is_read, created_at')
      .eq('company_id', profile.company_id)
      .or(`recipient_id.is.null,recipient_id.eq.${profile.id}`)
      .order('created_at', { ascending: false })
      .limit(15)
    filteredNotifications = data ?? []
  }

  const unreadCount = filteredNotifications.filter(n => !n.is_read).length

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AppNav email={user.email ?? ''} role={profile?.role ?? 'viewer'} userId={user.id} />

      {/* Notification bell — top right on desktop */}
      <div className="fixed top-3 right-4 z-20 hidden md:block">
        <NotificationBell
          initialNotifications={(filteredNotifications ?? []) as any[]}
          unreadCount={unreadCount}
        />
      </div>

      <main className="flex-1 pb-16 md:pb-0 overflow-y-auto">
        {children}
      </main>

      {/* In-app AI assistant */}
      <AskRps />
    </div>
  )
}
