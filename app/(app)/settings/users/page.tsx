import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { UserRoleForm } from './user-role-form'
import { AddEmployeeForm } from './add-employee-form'
import { DeleteUserButton } from './delete-user-button'
import { EditUserButton } from './edit-user-button'
import { updateUserRole, toggleUserActive } from './actions'

export default async function UsersSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role, id').eq('id', user!.id).single()

  if (!['owner', 'manager'].includes(profile?.role ?? '')) redirect('/settings')

  const { data: users } = await admin
    .from('profiles')
    .select('id, full_name, email, phone, role, is_active, created_at')
    .eq('company_id', profile!.company_id)
    .order('full_name')

  const ROLE_ORDER = ['owner', 'manager', 'shop_manager', 'shop_employee', 'service_tech', 'office_staff', 'viewer']

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
      </div>

      <div className="mb-6">
        <AddEmployeeForm />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 text-sm text-blue-800">
        <p className="font-semibold mb-1">How employees get access:</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
          <li>Each employee visits the app URL and signs in with their company Gmail.</li>
          <li>Their account is created automatically with the <strong>Viewer</strong> role.</li>
          <li>You change their role here to give them the right access level.</li>
        </ol>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              {profile!.role === 'owner' && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(users ?? []).map(u => {
              const isSelf = u.id === profile!.id
              async function handleRoleChange(newRole: string) {
                'use server'
                await updateUserRole(u.id, newRole)
              }
              async function handleToggleActive() {
                'use server'
                await toggleUserActive(u.id, !u.is_active)
              }
              return (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{u.full_name}</span>
                      {isSelf && <span className="text-xs text-gray-400">(you)</span>}
                      <EditUserButton user={{ id: u.id, full_name: u.full_name, email: u.email, phone: (u as any).phone ?? null }} />
                    </div>
                    {(u as any).phone && <p className="text-xs text-gray-400 mt-0.5">{(u as any).phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    {isSelf && profile!.role === 'owner' ? (
                      <span className="text-sm font-medium text-gray-700 capitalize">Owner</span>
                    ) : (
                      <UserRoleForm
                        userId={u.id}
                        currentRole={u.role}
                        onUpdate={handleRoleChange}
                        disabled={isSelf}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Active</span>
                    ) : (
                      <form action={handleToggleActive}>
                        <button
                          type="submit"
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${
                            u.is_active
                              ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                              : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {u.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </form>
                    )}
                  </td>
                  {/* Delete — owner only, can't delete yourself */}
                  {profile!.role === 'owner' && (
                    <td className="px-4 py-3 text-right">
                      {!isSelf && (
                        <DeleteUserButton userId={u.id} fullName={u.full_name} />
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 bg-gray-50 rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
        <p className="font-semibold text-gray-900 mb-2">Role descriptions:</p>
        <div className="space-y-1.5">
          <p><strong>Owner</strong> — Full access. Can manage users, settings, and see everything.</p>
          <p><strong>Manager</strong> — Can create/edit tickets, view reports, approve time entries.</p>
          <p><strong>Shop Manager</strong> — Manages repair tickets and shop employees. Can approve time.</p>
          <p><strong>Shop Employee</strong> — Can clock in/out, update ticket status, log time.</p>
          <p><strong>Mechanic</strong> — Shop mechanic. Can clock in/out, work on tickets, and log labor time.</p>
          <p><strong>Service Tech</strong> — Field technician. Can log mileage/hours and update asset status.</p>
          <p><strong>Construction Tech</strong> — Construction field technician. Can log time and view assigned work.</p>
          <p><strong>Office Staff</strong> — Administrative access. Can view assets and records.</p>
          <p><strong>Viewer</strong> — Read-only. Cannot edit anything.</p>
        </div>
      </div>
    </div>
  )
}
