'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteTicket } from '../actions'

export function DeleteTicketButton({ id, ticketNumber }: { id: string; ticketNumber: string }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!confirm(`Delete ticket ${ticketNumber}? This permanently removes the ticket and all its comments, photos, and labor entries. This cannot be undone.`)) return
    setDeleting(true)
    await deleteTicket(id)
  }

  return (
    <form onSubmit={handleDelete}>
      <button
        type="submit"
        disabled={deleting}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        {deleting ? 'Deleting…' : 'Delete Ticket'}
      </button>
    </form>
  )
}
