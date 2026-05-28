'use client'

import { Button } from '@/components/ui/button'
import { deleteAsset } from '../actions'

export function DeleteAssetButton({ id, unitNumber }: { id: string; unitNumber: string }) {
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!confirm(`Delete ${unitNumber}? This cannot be undone.`)) return
    await deleteAsset(id)
  }

  return (
    <form onSubmit={handleSubmit}>
      <Button type="submit" variant="destructive" className="text-sm">
        Delete Asset
      </Button>
    </form>
  )
}
