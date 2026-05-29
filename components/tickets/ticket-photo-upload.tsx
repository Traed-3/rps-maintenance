'use client'

import { useState } from 'react'
import { ImageUpload } from '@/components/ui/image-upload'

export function TicketPhotoUpload({
  ticketId,
  onSave,
}: {
  ticketId: string
  onSave: (fileUrl: string, fileName: string) => Promise<void>
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    if (!url) return
    setSaving(true)
    const fileName = url.split('/').pop() ?? 'photo.jpg'
    await onSave(url, fileName)
    setSaved(true)
    setSaving(false)
  }

  if (saved) {
    return (
      <div className="text-sm text-green-600 font-medium">✓ Photo saved to ticket</div>
    )
  }

  return (
    <div className="space-y-3">
      <ImageUpload
        bucket="ticket-attachments"
        value={url}
        onChange={setUrl}
        label="Upload Completion Photo"
      />
      {url && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Attach to Ticket'}
        </button>
      )}
    </div>
  )
}
