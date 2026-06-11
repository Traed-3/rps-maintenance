import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { ExpenseForm } from './expense-form'
import { createExpense } from '../actions'

export default async function NewExpensePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id').eq('id', user!.id).single()

  const [
    { data: assets },
    { data: paymentMethods },
    { data: assetCategories },
    { data: storeCategories },
    { data: openTickets },
  ] = await Promise.all([
    admin.from('assets').select('id, unit_number, name, make, model')
      .eq('company_id', profile!.company_id).neq('status', 'retired').order('unit_number'),
    admin.from('payment_methods').select('id, code, name')
      .eq('company_id', profile!.company_id).eq('is_active', true).order('code'),
    admin.from('expense_categories').select('id, name')
      .eq('company_id', profile!.company_id).eq('context', 'asset').order('sort_order'),
    admin.from('expense_categories').select('id, name')
      .eq('company_id', profile!.company_id).eq('context', 'store').order('sort_order'),
    admin.from('repair_tickets').select('id, ticket_number, title')
      .eq('company_id', profile!.company_id)
      .not('status', 'in', '(completed,closed,deferred)')
      .order('updated_at', { ascending: false }).limit(30),
  ])

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/expenses" className="text-sm text-gray-500 hover:text-gray-700">← Expenses</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">New Expense / Receipt</h1>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <ExpenseForm
          action={createExpense}
          assets={assets ?? []}
          paymentMethods={paymentMethods ?? []}
          assetCategories={assetCategories ?? []}
          storeCategories={storeCategories ?? []}
          openTickets={openTickets ?? []}
        />
      </div>
    </div>
  )
}
