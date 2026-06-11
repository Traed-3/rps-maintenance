'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { assignTicket } from '@/app/(app)/tickets/actions'

type Employee = { id: string; full_name: string }

/**
 * Inline "Assigned To" control for ticket lists. Shows the assignee name (or a
 * clickable "Unassigned"); clicking opens a dropdown to assign/reassign without
 * leaving the page. Marked data-no-row-nav so a clickable table row ignores it.
 */
export function AssignControl({
  ticketId,
  currentId,
  currentName,
  employees,
}: {
  ticketId: string
  currentId: string | null
  currentName: string | null
  employees: Employee[]
}) {
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value || null
    startTransition(async () => {
      await assignTicket(ticketId, value)
      setEditing(false)
      router.refresh()
    })
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-no-row-nav
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        className={
          currentName
            ? 'text-gray-700 hover:text-blue-600 hover:underline text-left'
            : 'text-blue-600 hover:text-blue-800 underline decoration-dotted underline-offset-2 text-left'
        }
      >
        {currentName ?? 'Unassigned'}
      </button>
    )
  }

  return (
    <select
      data-no-row-nav
      autoFocus
      defaultValue={currentId ?? ''}
      disabled={isPending}
      onChange={handleChange}
      onBlur={() => setEditing(false)}
      onClick={(e) => e.stopPropagation()}
      className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[150px]"
    >
      <option value="">— Unassigned —</option>
      {employees.map((emp) => (
        <option key={emp.id} value={emp.id}>{emp.full_name}</option>
      ))}
    </select>
  )
}
