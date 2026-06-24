'use client'

import { Printer } from 'lucide-react'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2"
    >
      <Printer className="w-4 h-4" /> Print / Save as PDF
    </button>
  )
}
