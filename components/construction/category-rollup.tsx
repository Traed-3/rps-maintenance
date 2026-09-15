import { PART_CATEGORIES, categoryLabel, money } from '@/lib/inventory'

type Line = {
  section: string | null
  description: string | null
  material_total: number | null
  total_labor: number | null
  item_type: string | null
  part_id: string | null
  parts?: { part_number: string | null; category: number | null; taxable: boolean | null } | null
}

/**
 * REV19 twelve-category roll-up of a quote's lines. Lines picked from the
 * catalog land in their part's category; free-text lines fall back on the
 * line's item type (labor → 7, trip → 8, equipment → 9, disposables → 10,
 * sub → 11, permit → 12, anything else → 4 Pump & Tank Materials).
 */
export function CategoryRollup({ lines }: { lines: Line[] }) {
  if (!lines.length) return null
  const FALLBACK: Record<string, number> = { labor: 7, trip: 8, equipment: 9, disposables: 10, sub: 11, permit: 12, lodging: 6 }
  const sums = new Map<number, { material: number; labor: number; count: number }>()
  for (const l of lines) {
    const cat = l.parts?.category ?? FALLBACK[l.item_type ?? ''] ?? 4
    const cur = sums.get(cat) ?? { material: 0, labor: 0, count: 0 }
    cur.material += Number(l.material_total ?? 0); cur.labor += Number(l.total_labor ?? 0); cur.count++
    sums.set(cat, cur)
  }
  const rows = PART_CATEGORIES.filter(c => sums.has(c.n)).map(c => ({ ...c, ...sums.get(c.n)! }))
  const taxable = rows.filter(r => r.taxable).reduce((a, r) => a + r.material + r.labor, 0)
  const site = rows.filter(r => [5, 9, 10, 11, 12].includes(r.n)).reduce((a, r) => a + r.material + r.labor, 0)
  const laborMob = rows.filter(r => [6, 7, 8].includes(r.n)).reduce((a, r) => a + r.material + r.labor, 0)
  const picked = lines.filter(l => l.part_id).length

  return (
    <details className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-5" open={picked > 0}>
      <summary className="px-5 py-3 cursor-pointer font-semibold text-gray-900 flex flex-wrap items-center justify-between gap-2">
        <span>REV19 category roll-up</span>
        <span className="text-xs font-normal text-gray-400">{picked} of {lines.length} lines linked to the catalog</span>
      </summary>
      <div className="px-5 pb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500"><th className="text-left py-1 font-medium">Category</th><th className="text-right py-1 font-medium">Lines</th><th className="text-right py-1 font-medium">Material</th><th className="text-right py-1 font-medium">Labor</th><th className="text-right py-1 font-medium">Total</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(r => (
              <tr key={r.n}>
                <td className="py-1.5 text-gray-800">{r.n}. {categoryLabel(r.n)}{r.taxable ? <span className="ml-2 text-xs text-gray-400">taxable</span> : null}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{r.count}</td>
                <td className="py-1.5 text-right tabular-nums">{money(r.material)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(r.labor)}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{money(r.material + r.labor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            <tr className="border-t border-gray-200"><td className="py-1.5 text-gray-600" colSpan={4}>Total taxable materials (1–4)</td><td className="py-1.5 text-right tabular-nums font-medium">{money(taxable)}</td></tr>
            <tr><td className="py-1.5 text-gray-600" colSpan={4}>Concrete, equipment, subcontractor, disposal, permits (5, 9–12)</td><td className="py-1.5 text-right tabular-nums font-medium">{money(site)}</td></tr>
            <tr><td className="py-1.5 text-gray-600" colSpan={4}>Labor, mobilization, lodging (6–8)</td><td className="py-1.5 text-right tabular-nums font-medium">{money(laborMob)}</td></tr>
          </tfoot>
        </table>
      </div>
    </details>
  )
}
