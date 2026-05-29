'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { deleteAsset } from '../actions'

export function DeleteAssetButton({ id, unitNumber }: { id: string; unitNumber: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!confirm(`Delete ${unitNumber}? This cannot be undone.`)) return
    setDeleting(true)
    await deleteAsset(id)
    // Force the client to navigate and clear the cache
    router.push('/assets')
    router.refresh()
  }

  return (
    <form onSubmit={handleDelete}>
      <Button type="submit" variant="destructive" className="text-sm" disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete Asset'}
      </Button>
    </form>
  )
}
