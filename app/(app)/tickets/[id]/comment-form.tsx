'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'

type ActionState = { error: string } | null

export function CommentForm({
  ticketId,
  action,
  canMarkInternal,
}: {
  ticketId: string
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  canMarkInternal: boolean
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="ticket_id" value={ticketId} />
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <textarea
        name="comment"
        rows={3}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Add a comment…"
        required
      />
      <div className="flex items-center justify-between">
        {canMarkInternal ? (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" name="is_internal" className="rounded border-gray-300 text-blue-600" />
            Internal note (not visible to all)
          </label>
        ) : <div />}
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Posting…' : 'Post Comment'}
        </Button>
      </div>
    </form>
  )
}
