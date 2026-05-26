import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import AppNav from '@/components/app-nav'
import { NotificationBell } from '@/components/notifications/notification-bell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // Fetch profile + recent notifications in parallel
  const [{ data: profile }, { data: notifications }] = await Promise.all([
    admin.from('profiles').select('id, company_id').eq('id', user.id).single(),
    admin.from('notifications')
      .select('id, type, title, message, link, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  // Filter: show broadcast (recipient_id null) + personal notifications
  const myNotifications = (notifications ?? []).filter(
    n => (n as any).recipient_id === null || (n as any).recipient_id === profile?.id
  )

  // Re-fetch with proper filter (workaround for Supabase OR filter)
  const { data: filteredNotifications } = await admin
    .from('notifications')
    .select('id, type, title, message, link, is_read, created_at')
    .eq('company_id', profile!.company_id)
    .or(`recipient_id.is.null,recipient_id.eq.${profile!.id}`)
    .order('created_at', { ascending: false })
    .limit(15)

  const unreadCount = (filteredNotifications ?? []).filter(n => !n.is_read).length

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AppNav email={user.email ?? ''} />

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
    </div>
  )
}
