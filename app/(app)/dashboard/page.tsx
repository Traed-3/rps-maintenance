import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, role')
    .eq('id', user!.id)
    .single()

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Welcome back, {profile?.full_name ?? user?.email}
          {profile?.role && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 capitalize">
              {profile.role.replace('_', ' ')}
            </span>
          )}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="text-4xl mb-3">🚧</div>
        <h2 className="text-lg font-semibold text-gray-900">Full dashboard coming in Step 11</h2>
        <p className="text-gray-500 mt-2 text-sm max-w-md mx-auto">
          Summary cards, live employee status table, open tickets, and maintenance alerts
          will all be built here. For now, use the sidebar to navigate to Assets.
        </p>
      </div>
    </div>
  )
}
