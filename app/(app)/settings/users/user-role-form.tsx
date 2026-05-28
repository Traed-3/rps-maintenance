'use client'

import { useTransition } from 'react'

const ROLES = [
  { value: 'owner',         label: 'Owner' },
  { value: 'manager',       label: 'Manager' },
  { value: 'shop_manager',  label: 'Shop Manager' },
  { value: 'shop_employee', label: 'Shop Employee' },
  { value: 'service_tech',  label: 'Service Tech' },
  { value: 'office_staff',  label: 'Office Staff' },
  { value: 'viewer',        label: 'Viewer' },
]

export function UserRoleForm({
  userId,
  currentRole,
  onUpdate,
  disabled,
}: {
  userId: string
  currentRole: string
  onUpdate: (role: string) => Promise<void>
  disabled?: boolean
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <select
      value={currentRole}
      disabled={disabled || isPending}
      onChange={e => {
        const newRole = e.target.value
        startTransition(() => onUpdate(newRole))
      }}
      className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 bg-white"
    >
      {ROLES.map(r => (
        <option key={r.value} value={r.value}>{r.label}</option>
      ))}
    </select>
  )
}
