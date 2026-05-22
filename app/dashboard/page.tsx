import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Logged in as {user.email}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-semibold text-gray-900">
            Authentication is working!
          </h2>
          <p className="text-gray-500 mt-2 text-sm">
            Step 3 complete. The full dashboard gets built in Step 11.
          </p>
        </div>
      </div>
    </main>
  )
}
