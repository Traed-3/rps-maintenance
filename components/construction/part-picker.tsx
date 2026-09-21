'use client'

import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { money, COST_SOURCE_LABEL } from '@/lib/inventory'

export type PickedPart = {
  id: string
  part_number: string | null
  description: string
  item_type: string | null
  uom: string | null
  unit_cost: number | null
  freight_per_unit: number | null
  cost_source: string | null
  cost_vendor: string | null
  cost_date: string | null
  price_status: string | null
  suggested_price: number | null
  category?: number | null
  taxable?: boolean | null
  cost_invoice_ref?: string | null
  markup_pct?: number | null
}

/**
 * Inline catalog search for a quote/invoice line. Type a part number or a few
 * words of description; pick a result to fill the line. The description stays
 * editable afterwards, so a picked part can still be reworded for the customer.
 */
export function PartPicker({
  value,
  onChange,
  onPick,
  placeholder = 'Description — or type a part number to search the catalog',
  className,
  category,
  autoFocus,
}: {
  value: string
  onChange: (text: string) => void
  onPick: (part: PickedPart) => void
  placeholder?: string
  className?: string
  /** Limit results to one REV19 category (the builder's per-category search boxes). */
  category?: number
  autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<PickedPart[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function search(text: string) {
    if (timer.current) clearTimeout(timer.current)
    if (text.trim().length < 2) { setResults([]); setOpen(false); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/inventory/parts/search?q=${encodeURIComponent(text)}&limit=12${category ? `&category=${category}` : ''}`, { cache: 'no-store' })
        const j = await r.json()
        setResults(j.parts ?? []); setOpen(true)
      } catch { setResults([]) } finally { setLoading(false) }
    }, 250)
  }

  return (
    <div ref={box} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); search(e.target.value) }}
        onFocus={() => { if (results.length) setOpen(true) }}
        autoFocus={autoFocus}
        className={className}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading && <Search className="w-3.5 h-3.5 text-gray-300 absolute right-2 top-2.5 animate-pulse" />}
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-[34rem] max-w-[90vw] max-h-72 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg text-sm" role="listbox">
          {results.map(p => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onPick(p); setOpen(false) }}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-gray-900 truncate">{p.description}</span>
                  <span className="tabular-nums text-gray-900 whitespace-nowrap">{p.suggested_price != null ? money(p.suggested_price) : <span className="text-pink-600">price needed</span>}</span>
                </div>
                <div className="text-xs text-gray-500 flex flex-wrap gap-x-2">
                  <span className="font-mono">{p.part_number ?? '—'}</span>
                  {p.unit_cost != null && <span>cost {money(p.unit_cost)}</span>}
                  {p.cost_source && <span>{COST_SOURCE_LABEL[p.cost_source] ?? p.cost_source}{p.cost_vendor ? ` · ${p.cost_vendor}` : ''}{p.cost_date ? ` · ${p.cost_date.slice(0, 10)}` : ''}</span>}
                  {p.price_status && p.price_status !== 'ok' && <span className="text-amber-700">{p.price_status.replace('_', ' ')}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
