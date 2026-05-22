import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/app-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AppNav email={user.email ?? ''} />
      <main className="flex-1 pb-16 md:pb-0 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
