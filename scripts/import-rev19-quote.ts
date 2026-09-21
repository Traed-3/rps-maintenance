/**
 * Load a REV19 workbook (parsed by scripts/parse-rev19-workbook.py) into Billing
 * as a quote, priced by the same lib/rev19 engine the app uses.
 *
 *   python3 scripts/parse-rev19-workbook.py "<workbook>.xlsx" > /tmp/quote.json
 *   npx tsx scripts/import-rev19-quote.ts /tmp/quote.json            # dry run: prints the face + checks the workbook total
 *   npx tsx scripts/import-rev19-quote.ts /tmp/quote.json --apply    # writes con_quotes + con_quote_line_items
 *
 * Customer, rate card (by labor rate), signer (by name) and catalog parts (by
 * part number) are matched by lookup; anything that does not match is left
 * null and reported so it can be fixed in the app.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as rev19mod from '../lib/rev19'
import type { Rev19Inputs, Rev19LineInput } from '../lib/rev19'

// tsx sometimes lands the module's exports on .default — take whichever has the function.
const { computeRev19 } = ((rev19mod as { computeRev19?: unknown }).computeRev19 ? rev19mod : (rev19mod as { default: typeof rev19mod }).default) as typeof rev19mod

const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m![1], m![2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const COMPANY_ID = env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'

type Parsed = {
  source_file: string
  header: Record<string, string | null>
  attn: string | null
  project_description: string | null
  scope_rows: { scope: string; description: string }[]
  inputs: Rev19Inputs
  lines: Rev19LineInput[]
  workbook_total: number | null
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const title = (s: string | null) => s ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null
const isoDate = (s: string | null) => { if (!s) return null; const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s }

async function main() {
  const [file, flag] = process.argv.slice(2)
  if (!file) { console.error('usage: npx tsx scripts/import-rev19-quote.ts <quote.json> [--apply]'); process.exit(1) }
  const apply = flag === '--apply'
  const q: Parsed = JSON.parse(readFileSync(file, 'utf-8'))

  // ── lookups ────────────────────────────────────────────────────────────────
  const notes: string[] = []
  const { data: customers } = await sb.from('con_customers').select('id, name').eq('company_id', COMPANY_ID)
  const customer = customers?.find(c => c.name.toLowerCase().includes((q.header.customer ?? '').toLowerCase())) ?? null
  if (!customer) notes.push(`customer "${q.header.customer}" not found — set it in the app`)

  const { data: cards } = await sb.from('billing_rate_cards').select('id, name, labor_rate').eq('company_id', COMPANY_ID)
  const card = cards?.find(c => Number(c.labor_rate) === q.inputs.labor_rate) ?? null
  if (!card) notes.push(`no rate card at $${q.inputs.labor_rate}/hr — labor_rate kept, rate_card_id left null`)

  const { data: people } = await sb.from('profiles').select('id, full_name, job_title').eq('company_id', COMPANY_ID)
  const signer = people?.find(p => p.full_name.toLowerCase().startsWith((q.header.signer_name ?? '¬').toLowerCase())) ?? null
  if (!signer) notes.push(`signer "${q.header.signer_name}" has no profile — prepared_by kept as text`)

  const partNos = q.lines.map(l => l.part_number).filter((s): s is string => !!s)
  const { data: parts } = partNos.length ? await sb.from('parts').select('id, part_number').eq('company_id', COMPANY_ID).in('part_number', partNos) : { data: [] }
  const partById = new Map((parts ?? []).map(p => [p.part_number, p.id]))

  const lines: Rev19LineInput[] = q.lines.map((l, i) => ({ ...l, line_no: i + 1, part_id: l.part_number ? partById.get(l.part_number) ?? null : null, price_flag: l.price_flag ?? 'ok' }))
  const unmatched = lines.filter(l => l.category <= 4 && l.part_number && !l.part_id).map(l => l.part_number)
  if (unmatched.length) notes.push(`catalog parts not matched (line still prices from the workbook cost): ${unmatched.join(', ')}`)

  // ── price it with the app's engine and check the workbook agrees ──────────
  const { lines: priced, totals } = computeRev19(lines, q.inputs)
  console.log(`\n${q.header.customer} ${q.header.site_number} — ${q.project_description}`)
  for (const r of totals.basic.rows) if (r.total) console.log(`  ${String(r.n).padStart(2)} ${r.name.padEnd(42)} ${money(r.total).padStart(14)}`)
  console.log(`  ${'GRAND TOTAL'.padEnd(45)} ${money(totals.final_total).padStart(14)}`)
  if (q.workbook_total != null) {
    const diff = Math.abs(totals.final_total - q.workbook_total)
    console.log(diff < 0.01 ? `  ✓ matches the workbook (${money(q.workbook_total)})` : `  ✗ WORKBOOK SAYS ${money(q.workbook_total)} — off by ${money(diff)}`)
    if (diff >= 0.01 && apply) { console.error('Refusing to write a quote that does not match its workbook.'); process.exit(2) }
  }
  for (const n of notes) console.log(`  ! ${n}`)
  if (!apply) { console.log('\nDry run. Add --apply to write it.'); return }

  // ── write, mirroring saveQuote() in app/(app)/billing/actions.ts ──────────
  const h = q.header
  const row = {
    company_id: COMPANY_ID, customer_id: customer?.id ?? null, department: 'construction', status: 'draft', is_starting_quote: true,
    attn: q.attn, store_label: h.site_number, site_number: h.site_number, facility_address: h.facility_address, city_state_zip: h.city_state_zip,
    project_description: q.project_description, scope_rows: q.scope_rows, csr_number: h.csr_number, proposal_date: isoDate(h.proposal_date), bid_due: isoDate(h.bid_due),
    project_manager: title(h.project_manager), construction_manager: title(h.construction_manager), foreman: title(h.foreman), compiled_by: title(h.compiled_by),
    signer_id: signer?.id ?? null, prepared_by: [h.signer_name, signer?.job_title ?? h.signer_title].filter(Boolean).join(', ') || null, rate_card_id: card?.id ?? null,
    material_markup_pct: q.inputs.material_markup_pct, material_tax_pct: q.inputs.material_tax_pct, sub_markup_pct: q.inputs.sub_markup_pct, labor_rate: q.inputs.labor_rate,
    contingency_pct: q.inputs.contingency_pct, contingency_flat: q.inputs.contingency_flat, profit_overhead_percent: q.inputs.profit_overhead_pct, sales_tax_percent: q.inputs.sales_tax_pct,
    basic_subtotal_material: totals.basic_subtotal_material, basic_subtotal_labor: totals.basic_subtotal_labor, basic_total: totals.basic_total,
    additional_subtotal_material: totals.additional_subtotal_material, additional_subtotal_labor: totals.additional_subtotal_labor, additional_total: totals.additional_total,
    grand_total: totals.grand_total, contingency_amount: totals.contingency_amount, profit_overhead_amount: totals.profit_overhead_amount, tax_amount: totals.tax_amount,
    category_totals: totals.category_totals, taxable_material_total: totals.taxable_material_total, concrete_equipment_total: totals.concrete_equipment_total, labor_mobilization_total: totals.labor_mobilization_total,
    final_total: totals.final_total, source_file: q.source_file,
  }
  const { data: created, error } = await sb.from('con_quotes').insert(row).select('id, quote_number').single()
  if (error || !created) { console.error(error?.message); process.exit(1) }
  const items = priced.map((l, i) => ({
    quote_id: created.id, section: l.section, line_no: i + 1, sort_order: i + 1, category: l.category, subcategory: l.subcategory ?? null,
    description: l.description ?? null, part_number: l.part_number ?? null, part_id: l.part_id ?? null, item_type: null, is_stock: false,
    quantity: l.quantity_effective, unit_cost: l.unit_cost ?? null, sales_tax_pct: l.sales_tax_pct ?? null, markup_pct: l.markup_pct ?? null,
    freight_per_unit: l.freight_per_unit ?? null, markup_applies: !!l.markup_applies, sell_unit: l.sell_unit,
    men: l.men ?? null, hrs_each: l.hrs_each ?? null, travel_days: l.travel_days ?? null, techs: l.techs ?? null, day_label: l.day_label ?? null, crew: l.crew ?? null,
    labor_hours: l.labor_hours || null, labor_rate: l.category === 7 ? l.sell_unit : null, total_labor: l.total_labor, material_total: l.material_total, total_material_labor: l.total_material_labor,
    source_note: l.source_note ?? null, price_flag: l.price_flag ?? 'ok',
  }))
  const { error: e2 } = await sb.from('con_quote_line_items').insert(items)
  if (e2) { console.error(e2.message); await sb.from('con_quotes').delete().eq('id', created.id); process.exit(1) }
  console.log(`\nSaved ${created.quote_number} (${created.id}) with ${items.length} lines.`)
}

main()
