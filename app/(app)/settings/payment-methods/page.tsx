import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { togglePaymentMethod } from '@/app/(app)/expenses/actions'
import { addPaymentMethodDirect } from './actions'

export default async function PaymentMethodsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()
  if (!['owner', 'manager'].includes(profile?.role ?? '')) redirect('/settings')

  const { data: methods } = await admin
    .from('payment_methods')
    .select('id, code, name, is_active')
    .eq('company_id', profile!.company_id)
    .order('code')

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">Payment Methods</h1>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        These codes appear on expense receipts. Keep them short (2–6 letters) and memorable.
        Inactive codes are hidden from forms but old records keep their code.
      </p>

      {/* Existing methods */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="font-semibold text-sm text-gray-900">Current Codes</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {(methods ?? []).map(m => {
            async function handleToggle() {
              'use server'
              await togglePaymentMethod(m.id, !m.is_active)
            }
            return (
              <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-sm bg-gray-100 px-2.5 py-1 rounded-lg">{m.code}</span>
                  <span className="text-sm text-gray-700">{m.name}</span>
                </div>
                <form action={handleToggle}>
                  <button type="submit" className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                    m.is_active
                      ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                      : 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200'
                  }`}>
                    {m.is_active ? 'Active' : 'Inactive'}
                  </button>
                </form>
              </div>
            )
          })}
        </div>
      </div>

      {/* Add new */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Add New Code</h2>
        <form action={addPaymentMethodDirect} className="flex gap-3">
          <input
            name="code"
            className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="ABC"
            maxLength={6}
          />
          <input
            name="name"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Full name, e.g. Amazon Business Card"
          />
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            Add
          </button>
        </form>
      </div>
    </div>
  )
}
