import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { money, fmtDate } from '@/lib/billing'
import { REV19_CATEGORIES, categoryMeta, computeRev19, type Rev19Inputs, type Rev19LineInput, type Rev19Totals, type Rev19Line } from '@/lib/rev19'

// ── What the renderer needs (a quote or an invoice, normalized) ──
export type BillingDoc = {
  kind: 'Proposal' | 'Invoice'
  starting: boolean                       // "STARTING QUOTE — NOT A FINAL QUOTE" banner
  number: string
  date: string | null
  bidDue?: string | null
  customerName: string | null
  attn: string | null
  customerAddress: string | null
  siteNumber: string | null
  storeLabel: string | null
  facilityAddress: string | null
  cityStateZip: string | null
  csrNumber?: string | null
  poNumber?: string | null
  workOrder?: string | null
  dueDate?: string | null
  projectDescription: string | null
  scopeRows: { scope: string; description: string }[]
  exclusions?: string | null
  warranty?: string | null
  projectManager?: string | null
  constructionManager?: string | null
  foreman?: string | null
  compiledBy?: string | null
  preparedBy: string | null
  inputs: Rev19Inputs
  laborRateLabel?: string | null
}

const NAVY = '#16243d', GRAY = '#6b7280', LINE = '#d1d5db', PINK = '#fce7f3', GREEN = '#dcfce7', ORANGE = '#ffedd5'
const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  company: { fontSize: 14, fontWeight: 'bold', color: NAVY },
  small: { fontSize: 8, color: GRAY },
  h1: { fontSize: 16, fontWeight: 'bold', color: NAVY, marginTop: 8 },
  banner: { backgroundColor: PINK, color: '#9d174d', padding: 4, fontSize: 8, fontWeight: 'bold', marginTop: 6 },
  row: { flexDirection: 'row' },
  box: { borderWidth: 1, borderColor: LINE, padding: 6, flex: 1 },
  label: { fontSize: 7, color: GRAY, textTransform: 'uppercase' },
  section: { backgroundColor: NAVY, color: '#fff', padding: 4, fontSize: 9, fontWeight: 'bold', marginTop: 12 },
  th: { fontSize: 7, fontWeight: 'bold', color: GRAY, paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 1, borderColor: LINE },
  td: { fontSize: 8.5, paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderColor: '#eee' },
  right: { textAlign: 'right' },
  bold: { fontWeight: 'bold' },
  total: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 2 },
  totalLabel: { width: 220, textAlign: 'right', paddingRight: 8, color: GRAY },
  totalValue: { width: 90, textAlign: 'right' },
  sig: { marginTop: 28, flexDirection: 'row', justifyContent: 'space-between' },
})

const W = { n: 18, name: 150, qty: 42, unit: 52, mat: 62, hrs: 46, rate: 48, lab: 62, tot: 66 }

function Header({ doc, title }: { doc: BillingDoc; title: string }) {
  return (
    <View>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View>
          <Text style={s.company}>RAPPAHANNOCK PETROLEUM SERVICES</Text>
          <Text style={s.small}>225 Ritter Rd, Winchester, VA 22602 · (540) 869-5033 · fax (540) 869-5406</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.h1}>{title}</Text>
          <Text style={s.small}>{doc.kind === 'Proposal' ? 'PROPOSAL DATE' : 'INVOICE DATE'}: {doc.date ?? '—'}</Text>
          {doc.csrNumber ? <Text style={s.small}>CSR #: {doc.csrNumber}</Text> : null}
          {doc.workOrder ? <Text style={s.small}>WO #: {doc.workOrder}</Text> : null}
          {doc.poNumber ? <Text style={s.small}>PO #: {doc.poNumber}</Text> : null}
          {doc.bidDue ? <Text style={s.small}>BID DUE: {doc.bidDue}</Text> : null}
          {doc.dueDate ? <Text style={s.small}>DUE: {doc.dueDate}</Text> : null}
        </View>
      </View>
      {doc.starting ? <Text style={s.banner}>STARTING QUOTE — NOT A FINAL QUOTE. Every price carries its source and date; pink items need a price or verification before this goes out.</Text> : null}
      <View style={[s.row, { marginTop: 10, gap: 8 }]}>
        <View style={s.box}>
          <Text style={s.label}>Customer</Text>
          <Text style={s.bold}>{doc.customerName ?? '—'}</Text>
          {doc.customerAddress ? <Text>{doc.customerAddress}</Text> : null}
          {doc.attn ? <Text>ATTN: {doc.attn}</Text> : null}
        </View>
        <View style={s.box}>
          <Text style={s.label}>Location</Text>
          <Text style={s.bold}>{[doc.storeLabel, doc.siteNumber].filter(Boolean).join(' · ') || '—'}</Text>
          {doc.facilityAddress ? <Text>{doc.facilityAddress}</Text> : null}
          {doc.cityStateZip ? <Text>{doc.cityStateZip}</Text> : null}
        </View>
      </View>
      {doc.projectDescription ? <View style={{ marginTop: 8 }}><Text style={s.label}>Project description</Text><Text style={s.bold}>{doc.projectDescription}</Text></View> : null}
    </View>
  )
}

function ScopeTable({ rows }: { rows: { scope: string; description: string }[] }) {
  if (!rows.length) return null
  return (
    <View>
      <Text style={s.section}>SCOPE OF WORK · DESCRIPTION OF WORK</Text>
      {rows.map((r, i) => (
        <View key={i} style={[s.row, { borderBottomWidth: 0.5, borderColor: '#eee' }]}>
          <Text style={[s.td, s.bold, { width: 170 }]}>{r.scope}</Text>
          <Text style={[s.td, { flex: 1 }]}>{r.description}</Text>
        </View>
      ))}
    </View>
  )
}

/** The RP QUOTE TEMPLATE face: one row per category that carries money, per section. */
function FaceTable({ title, face, laborRate }: { title: string; face: Rev19Totals['basic']; laborRate: number }) {
  if (!face.rows.length) return null
  return (
    <View wrap={false}>
      <Text style={s.section}>{title}</Text>
      <View style={s.row}>
        <Text style={[s.th, { width: W.n }]}>#</Text><Text style={[s.th, { width: W.name }]}>CATEGORY</Text>
        <Text style={[s.th, s.right, { width: W.qty }]}>QTY</Text><Text style={[s.th, s.right, { width: W.unit }]}>UNIT COST</Text>
        <Text style={[s.th, s.right, { width: W.mat }]}>MATERIAL</Text><Text style={[s.th, s.right, { width: W.hrs }]}>LABOR HRS</Text>
        <Text style={[s.th, s.right, { width: W.rate }]}>RATE</Text><Text style={[s.th, s.right, { width: W.lab }]}>TOTAL LABOR</Text>
        <Text style={[s.th, s.right, { width: W.tot }]}>MATERIAL & LABOR</Text>
      </View>
      {face.rows.map(r => (
        <View key={r.n} style={s.row}>
          <Text style={[s.td, { width: W.n }]}>{r.n}</Text><Text style={[s.td, { width: W.name }]}>{r.name}</Text>
          <Text style={[s.td, s.right, { width: W.qty }]}>{r.n === 7 ? '' : r.quantity || ''}</Text>
          <Text style={[s.td, s.right, { width: W.unit }]}>{r.unit_cost != null ? money(r.unit_cost) : ''}</Text>
          <Text style={[s.td, s.right, { width: W.mat }]}>{r.material ? money(r.material) : ''}</Text>
          <Text style={[s.td, s.right, { width: W.hrs }]}>{r.labor_hours || ''}</Text>
          <Text style={[s.td, s.right, { width: W.rate }]}>{r.n === 7 ? money(r.labor_rate ?? laborRate) : ''}</Text>
          <Text style={[s.td, s.right, { width: W.lab }]}>{r.total_labor ? money(r.total_labor) : ''}</Text>
          <Text style={[s.td, s.right, s.bold, { width: W.tot }]}>{money(r.total)}</Text>
        </View>
      ))}
      <View style={[s.row, { backgroundColor: '#f3f4f6' }]}>
        <Text style={[s.td, { width: W.n + W.name + W.qty + W.unit }]}>Sub Total Material: {money(face.subtotal_material)}</Text>
        <Text style={[s.td, { width: W.mat + W.hrs + W.rate + W.lab }]}>Sub Total Labor: {money(face.subtotal_labor)}</Text>
        <Text style={[s.td, s.right, s.bold, { width: W.tot }]}>{money(face.total)}</Text>
      </View>
    </View>
  )
}

function Totals({ doc, t }: { doc: BillingDoc; t: Rev19Totals }) {
  const T = ({ l, v, strong }: { l: string; v: number; strong?: boolean }) => (
    <View style={s.total}><Text style={[s.totalLabel, strong ? s.bold : {}]}>{l}</Text><Text style={[s.totalValue, strong ? s.bold : {}]}>{money(v)}</Text></View>
  )
  return (
    <View style={{ marginTop: 10 }} wrap={false}>
      {t.basic.rows.length ? <T l="BASIC INSTALLATION TOTAL" v={t.basic.total} /> : null}
      {t.additional.rows.length ? <T l="ADDITIONAL SCOPE OF WORK TOTAL" v={t.additional.total} /> : null}
      <T l="GRAND TOTAL" v={t.grand_total} strong />
      <T l={`CONTINGENCY ${(doc.inputs.contingency_pct * 100).toFixed(2)}%${doc.inputs.contingency_flat ? ` + ${money(doc.inputs.contingency_flat)}` : ''}`} v={t.contingency_amount} />
      <T l={`PROFIT AND OVERHEAD ${(doc.inputs.profit_overhead_pct * 100).toFixed(2)}%`} v={t.profit_overhead_amount} />
      <T l={`SALES TAX PERCENT (MATERIAL ONLY) ${(doc.inputs.sales_tax_pct * 100).toFixed(2)}%`} v={t.tax_amount} />
      <View style={[s.total, { borderTopWidth: 1, borderColor: NAVY, marginTop: 4, paddingTop: 4 }]}>
        <Text style={[s.totalLabel, s.bold, { color: NAVY, fontSize: 11 }]}>{doc.kind === 'Proposal' ? 'PROPOSAL GRAND TOTAL' : 'INVOICE GRAND TOTAL'}</Text>
        <Text style={[s.totalValue, s.bold, { color: NAVY, fontSize: 11 }]}>{money(t.final_total)}</Text>
      </View>
    </View>
  )
}

function Signature({ doc }: { doc: BillingDoc }) {
  return (
    <View style={s.sig} wrap={false}>
      <View><Text style={{ borderTopWidth: 1, borderColor: '#111', width: 220, paddingTop: 3 }}>{doc.preparedBy ?? 'Starsky Dodson, Construction Manager'}</Text></View>
      <View><Text style={{ borderTopWidth: 1, borderColor: '#111', width: 120, paddingTop: 3 }}>DATE</Text></View>
    </View>
  )
}

/** MATERIAL AND LABOR BREAKDOWN — one block per category with that category's columns. */
function Breakdown({ doc, lines, t }: { doc: BillingDoc; lines: Rev19Line[]; t: Rev19Totals }) {
  const fill = (l: Rev19Line) => l.price_flag && l.price_flag !== 'ok' ? PINK : /RECEIPT|QUOTE/i.test(l.source_note ?? '') ? GREEN : l.category === 11 ? ORANGE : undefined
  const Head = ({ cols }: { cols: [string, number, boolean?][] }) => <View style={s.row}>{cols.map(([c, w, r]) => <Text key={c} style={[s.th, r ? s.right : {}, { width: w }]}>{c}</Text>)}</View>
  const Cell = ({ v, w, r, b }: { v: string | number | null | undefined; w: number; r?: boolean; b?: boolean }) => <Text style={[s.td, r ? s.right : {}, b ? s.bold : {}, { width: w }]}>{v == null || v === '' ? '' : String(v)}</Text>
  return (
    <View>
      <View style={[s.row, { gap: 8, marginTop: 8 }]}>
        <View style={s.box}>
          <Text style={s.label}>Inputs</Text>
          <Text>Material markup {(doc.inputs.material_markup_pct * 100).toFixed(2)}% · Tax on material {(doc.inputs.material_tax_pct * 100).toFixed(2)}% · Sub markup {(doc.inputs.sub_markup_pct * 100).toFixed(2)}%</Text>
          <Text>Labor rate {money(doc.inputs.labor_rate)}/hr{doc.laborRateLabel ? ` (${doc.laborRateLabel})` : ''} · Contingency {(doc.inputs.contingency_pct * 100).toFixed(2)}% · P&amp;O {(doc.inputs.profit_overhead_pct * 100).toFixed(2)}%</Text>
          <Text style={s.small}>Categories 1–4: (Cost + Tax) × (1 + Markup) + Freight, × Qty. Categories 5, 9, 10, 12: cost, markup only where marked. Category 11: cost + {(doc.inputs.sub_markup_pct * 100).toFixed(0)}% on the category. Pink = estimate / PRICE NEEDED / held; green = receipt or vendor quote; orange = subcontractor.</Text>
        </View>
        <View style={[s.box, { flex: 0.6 }]}>
          <Text style={s.label}>Team</Text>
          <Text>Project manager: {doc.projectManager ?? '—'}</Text>
          <Text>Construction manager: {doc.constructionManager ?? 'Starsky Dodson'}</Text>
          <Text>Foreman / lead: {doc.foreman ?? 'Ernie Lewis'}</Text>
          <Text>Work order compiled by: {doc.compiledBy ?? 'Trae Dodson'}</Text>
        </View>
      </View>
      {(['basic', 'additional'] as const).map(section => REV19_CATEGORIES.map(c => {
        const ls = lines.filter(l => l.section === section && l.category === c.n)
        if (!ls.length) return null
        const catTotal = t[section].rows.find(r => r.n === c.n)
        const kind = c.kind
        return (
          <View key={`${section}-${c.n}`} wrap={false}>
            <Text style={s.section}>CATEGORY {c.n} — {c.name}{section === 'additional' ? '   (ADDITIONAL SCOPE)' : ''}</Text>
            {kind === 'material' && <Head cols={[['PART #', 66], ['DESCRIPTION', 200], ['UNIT COST', 46, true], ['TAX', 34, true], ['MARKUP', 40, true], ['FREIGHT', 40, true], ['SELL/UNIT', 48, true], ['QTY', 32, true], ['EXTENDED', 58, true], ['SOURCE', 150]]} />}
            {kind === 'labor' && <Head cols={[['DAY', 50], ['SCOPE OF WORK FOR THAT DAY', 300], ['RATE/HR', 46, true], ['MEN', 32, true], ['HRS EACH', 42, true], ['HOURS', 40, true], ['EXTENDED', 60, true], ['NOTE', 140]]} />}
            {kind === 'trip' && <Head cols={[['TRIP', 60], ['DESCRIPTION', 220], ['RATE', 46, true], ['TRAVEL DAYS', 56, true], ['TECHS', 36, true], ['TECH-TRAVEL-DAYS', 74, true], ['EXTENDED', 60, true]]} />}
            {(kind === 'costplus' || kind === 'sub' || kind === 'lodging') && <Head cols={[['ITEM / DESCRIPTION', 290], [kind === 'lodging' ? 'RATE' : 'UNIT COST', 56, true], ['MARKUP?', 40, true], ['SELL/UNIT', 56, true], [kind === 'lodging' ? 'TECH-NIGHTS' : 'QTY', 50, true], ['EXTENDED', 60, true], ['SOURCE', 160]]} />}
            {ls.map((l, i) => (
              <View key={i} style={[s.row, fill(l) ? { backgroundColor: fill(l) } : {}]}>
                {kind === 'material' && <><Cell v={l.part_number} w={66} /><Cell v={l.description} w={200} /><Cell v={money(l.unit_cost)} w={46} r /><Cell v={`${(((l.sales_tax_pct ?? doc.inputs.material_tax_pct)) * 100).toFixed(1)}%`} w={34} r /><Cell v={`${(((l.markup_pct ?? doc.inputs.material_markup_pct)) * 100).toFixed(0)}%`} w={40} r /><Cell v={l.freight_per_unit ? money(l.freight_per_unit) : ''} w={40} r /><Cell v={money(l.sell_unit)} w={48} r /><Cell v={l.quantity_effective} w={32} r /><Cell v={money(l.material_total)} w={58} r b /><Cell v={l.source_note} w={150} /></>}
                {kind === 'labor' && <><Cell v={l.day_label} w={50} /><Cell v={`${l.crew === 'service' ? 'SERVICE TECH — ' : ''}${l.description ?? ''}`} w={300} /><Cell v={money(l.sell_unit)} w={46} r /><Cell v={l.men} w={32} r /><Cell v={l.hrs_each} w={42} r /><Cell v={l.labor_hours} w={40} r /><Cell v={money(l.total_labor)} w={60} r b /><Cell v={l.source_note} w={140} /></>}
                {kind === 'trip' && <><Cell v={l.day_label} w={60} /><Cell v={`${l.crew === 'service' ? 'SERVICE TECH — ' : ''}${l.description ?? ''}`} w={220} /><Cell v={money(l.sell_unit)} w={46} r /><Cell v={l.travel_days} w={56} r /><Cell v={l.techs} w={36} r /><Cell v={l.quantity_effective} w={74} r /><Cell v={money(l.material_total)} w={60} r b /></>}
                {(kind === 'costplus' || kind === 'sub' || kind === 'lodging') && <><Cell v={[l.part_number, l.description].filter(Boolean).join(' — ')} w={290} /><Cell v={money(l.unit_cost)} w={56} r /><Cell v={kind === 'costplus' ? (l.markup_applies ? 'Y' : 'N') : kind === 'sub' ? `${(doc.inputs.sub_markup_pct * 100).toFixed(0)}%` : ''} w={40} r /><Cell v={money(l.sell_unit)} w={56} r /><Cell v={l.quantity_effective} w={50} r /><Cell v={money(l.material_total)} w={60} r b /><Cell v={l.source_note} w={160} /></>}
              </View>
            ))}
            {c.n === 11 && <View style={s.row}><Text style={[s.td, { width: 372 }]}>SUBCONTRACTOR MARKUP {(doc.inputs.sub_markup_pct * 100).toFixed(0)}% ON THE LINES ABOVE</Text><Text style={[s.td, s.right, { width: 60 }]}>{money((catTotal?.material ?? 0) - ls.reduce((a, l) => a + l.material_total, 0))}</Text></View>}
            <View style={[s.row, { backgroundColor: '#f3f4f6' }]}><Text style={[s.td, s.bold, { width: 372 }]}>TOTAL CATEGORY {c.n}</Text><Text style={[s.td, s.right, s.bold, { width: 60 }]}>{money(catTotal?.total ?? 0)}</Text></View>
          </View>
        )
      }))}
      <View style={{ marginTop: 10 }} wrap={false}>
        <Text style={s.section}>ROLL-UP</Text>
        <View style={s.total}><Text style={s.totalLabel}>TOTAL TAXABLE MATERIALS (CATEGORIES 1–4)</Text><Text style={s.totalValue}>{money(t.taxable_material_total)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>TOTAL CONCRETE, EQUIPMENT, SUBCONTRACTOR, DISPOSAL AND PERMITS (5+9+10+11+12)</Text><Text style={s.totalValue}>{money(t.concrete_equipment_total)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>TOTAL LABOR, MOBILIZATION AND LODGING (6+7+8)</Text><Text style={s.totalValue}>{money(t.labor_mobilization_total)}</Text></View>
        <View style={s.total}><Text style={[s.totalLabel, s.bold]}>SUBTOTAL ALL CATEGORIES</Text><Text style={[s.totalValue, s.bold]}>{money(t.grand_total)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>CONTINGENCY</Text><Text style={s.totalValue}>{money(t.contingency_amount)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>PROFIT AND OVERHEAD</Text><Text style={s.totalValue}>{money(t.profit_overhead_amount)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>SALES TAX (QUOTE LEVEL)</Text><Text style={s.totalValue}>{money(t.tax_amount)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>PROJECT MANAGEMENT FEE</Text><Text style={s.totalValue}>NONE</Text></View>
        <View style={[s.total, { borderTopWidth: 1, borderColor: NAVY, marginTop: 4, paddingTop: 4 }]}><Text style={[s.totalLabel, s.bold, { color: NAVY, fontSize: 11 }]}>GRAND TOTAL{doc.starting ? ' — STARTING QUOTE' : ''}</Text><Text style={[s.totalValue, s.bold, { color: NAVY, fontSize: 11 }]}>{money(t.final_total)}</Text></View>
      </View>
    </View>
  )
}

export async function renderBillingPdf(doc: BillingDoc, items: Rev19LineInput[], view: 'face' | 'breakdown' | 'both' = 'both'): Promise<Buffer> {
  const { lines, totals } = computeRev19(items, doc.inputs)
  const title = doc.kind === 'Proposal' ? (doc.starting ? 'STARTING QUOTE' : 'PROPOSAL') : 'INVOICE'
  const pdf = (
    <Document title={`${title} ${doc.number}`} author="Rappahannock Petroleum Services">
      {view !== 'breakdown' && (
        <Page size="LETTER" style={s.page}>
          <Header doc={doc} title={`${title} ${doc.number}`} />
          <ScopeTable rows={doc.scopeRows} />
          <FaceTable title="BASIC INSTALLATION" face={totals.basic} laborRate={doc.inputs.labor_rate} />
          <FaceTable title="ADDITIONAL SCOPE OF WORK" face={totals.additional} laborRate={doc.inputs.labor_rate} />
          <Totals doc={doc} t={totals} />
          {doc.exclusions ? <View style={{ marginTop: 10 }}><Text style={s.label}>Exclusions and clarifications</Text><Text>{doc.exclusions}</Text></View> : null}
          {doc.warranty ? <Text style={{ marginTop: 6 }}>{doc.warranty}</Text> : null}
          <Signature doc={doc} />
          <Text style={[s.small, { position: 'absolute', bottom: 20, left: 36 }]}>Labor rate {money(doc.inputs.labor_rate)}/hr{doc.laborRateLabel ? ` (${doc.laborRateLabel})` : ''} · Material markup {(doc.inputs.material_markup_pct * 100).toFixed(0)}% · No project management fee</Text>
        </Page>
      )}
      {view !== 'face' && (
        <Page size="LETTER" orientation="landscape" style={s.page}>
          <Header doc={doc} title={`MATERIAL AND LABOR BREAKDOWN — ${doc.number}`} />
          <Breakdown doc={doc} lines={lines} t={totals} />
        </Page>
      )}
    </Document>
  )
  return renderToBuffer(pdf)
}

/** Map a con_quotes / con_invoices row + its line rows into the renderer's inputs. */
export function docFromRow(kind: 'quote' | 'invoice', row: Record<string, unknown>, customer: { name: string; billing_address: string | null } | null, lines: Record<string, unknown>[]): { doc: BillingDoc; items: Rev19LineInput[] } {
  const N = (v: unknown) => (v == null || v === '' ? null : Number(v))
  const S = (v: unknown) => (v == null ? null : String(v))
  const inputs: Rev19Inputs = {
    material_markup_pct: N(row.material_markup_pct) ?? 0.2, material_tax_pct: N(row.material_tax_pct) ?? 0.053, sub_markup_pct: N(row.sub_markup_pct) ?? 0.15,
    labor_rate: N(row.labor_rate) ?? 0, contingency_pct: N(row.contingency_pct) ?? 0, contingency_flat: N(row.contingency_flat) ?? 0,
    profit_overhead_pct: N(row.profit_overhead_percent) ?? 0, sales_tax_pct: N(row.sales_tax_percent) ?? 0,
  }
  const items: Rev19LineInput[] = lines.map(l => ({
    section: l.section === 'additional' ? 'additional' : 'basic', category: Number(l.category) || 4, description: S(l.description), part_number: S(l.part_number), part_id: S(l.part_id),
    quantity: N(l.quantity), unit_cost: N(l.unit_cost), sales_tax_pct: N(l.sales_tax_pct), markup_pct: N(l.markup_pct), freight_per_unit: N(l.freight_per_unit), markup_applies: !!l.markup_applies,
    men: N(l.men), hrs_each: N(l.hrs_each), labor_rate: N(l.men) == null && Number(l.category) === 7 ? N(l.labor_rate) : N(l.labor_rate), travel_days: N(l.travel_days), techs: N(l.techs),
    day_label: S(l.day_label), crew: S(l.crew), source_note: S(l.source_note), price_flag: S(l.price_flag), item_type: S(l.item_type),
    // legacy lines: hours lived in labor_hours with no men/hrs split
    ...(Number(l.category) === 7 && N(l.men) == null && N(l.labor_hours) != null ? { men: 1, hrs_each: N(l.labor_hours) } : {}),
  }))
  const rateLabel = inputs.labor_rate === 78.5 ? '7-Eleven' : inputs.labor_rate === 82.5 ? 'Global' : inputs.labor_rate === 80 ? 'Sunoco' : inputs.labor_rate === 95 ? 'Independent' : null
  const doc: BillingDoc = {
    kind: kind === 'quote' ? 'Proposal' : 'Invoice', starting: kind === 'quote' && row.is_starting_quote !== false,
    number: S(kind === 'quote' ? row.quote_number : row.invoice_number) ?? 'DRAFT',
    date: fmtDate(S(kind === 'quote' ? row.proposal_date : row.invoice_date)), bidDue: row.bid_due ? fmtDate(S(row.bid_due)) : null,
    customerName: customer?.name ?? null, attn: S(row.attn), customerAddress: customer?.billing_address ?? null,
    siteNumber: S(row.site_number), storeLabel: S(row.store_label), facilityAddress: S(row.facility_address), cityStateZip: S(row.city_state_zip),
    csrNumber: S(row.csr_number), poNumber: S(row.po_number), workOrder: S(row.portal_wo_number) ?? S(row.work_order_number), dueDate: row.due_date ? fmtDate(S(row.due_date)) : null,
    projectDescription: S(row.project_description), scopeRows: Array.isArray(row.scope_rows) ? (row.scope_rows as { scope: string; description: string }[]) : [],
    exclusions: S(row.exclusions), warranty: S(row.warranty_line), projectManager: S(row.project_manager), constructionManager: S(row.construction_manager), foreman: S(row.foreman), compiledBy: S(row.compiled_by),
    preparedBy: S(row.prepared_by), inputs, laborRateLabel: rateLabel,
  }
  return { doc, items }
}

export { categoryMeta }
