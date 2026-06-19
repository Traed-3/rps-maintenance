import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { money } from '@/lib/construction'

// ── Types the PDF needs (a quote or an invoice, normalized) ──
export type PdfLine = {
  section: string | null
  description: string | null
  quantity: number | null
  unit_cost: number | null
  material_total: number | null
  labor_hours: number | null
  labor_rate: number | null
  total_labor: number | null
  total_material_labor: number | null
}

export type PdfDoc = {
  kind: 'Proposal' | 'Invoice'
  number: string
  date: string | null
  customerName: string | null
  attn: string | null
  customerAddress: string | null
  storeLabel: string | null
  facilityAddress: string | null
  cityStateZip: string | null
  csrNumber?: string | null
  poNumber?: string | null
  dueDate?: string | null
  projectDescription: string | null
  basicSubtotalMaterial: number
  basicSubtotalLabor: number
  basicTotal: number
  additionalSubtotalMaterial: number
  additionalSubtotalLabor: number
  additionalTotal: number
  grandTotal: number
  profitOverheadAmount: number
  taxAmount: number
  finalTotal: number
  preparedBy: string | null
}

const NAVY = '#16243d'
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#1f2937' },
  brand: { fontSize: 16, fontWeight: 'bold', color: NAVY },
  brandSub: { fontSize: 8, color: '#6b7280', marginTop: 2 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  block: { width: '48%' },
  docTitle: { fontSize: 18, fontWeight: 'bold', color: NAVY, textAlign: 'right' },
  label: { fontSize: 7.5, color: '#9ca3af', textTransform: 'uppercase' },
  value: { fontSize: 9, marginBottom: 3 },
  rightLine: { textAlign: 'right', fontSize: 9, marginBottom: 2 },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', color: '#fff', backgroundColor: NAVY, padding: 4, marginTop: 14 },
  th: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' },
  tr: { flexDirection: 'row', borderBottom: '0.5px solid #f0f0f0' },
  cellDesc: { width: '34%', padding: 3 },
  cell: { width: '11%', padding: 3, textAlign: 'right' },
  thText: { fontSize: 7.5, fontWeight: 'bold', color: '#6b7280' },
  totals: { marginTop: 12, marginLeft: 'auto', width: '46%' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  totalLabel: { color: '#6b7280' },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTop: '1px solid #16243d', marginTop: 3 },
  grandLabel: { fontSize: 11, fontWeight: 'bold', color: NAVY },
  grandValue: { fontSize: 11, fontWeight: 'bold', color: NAVY },
  sig: { marginTop: 36, borderTop: '1px solid #d1d5db', width: '50%', paddingTop: 6 },
  desc: { marginTop: 12, padding: 6, backgroundColor: '#f9fafb', fontSize: 9 },
})

function LineTable({ title, lines }: { title: string; lines: PdfLine[] }) {
  if (!lines.length) return null
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.th}>
        <Text style={[styles.cellDesc, styles.thText]}>Description</Text>
        <Text style={[styles.cell, styles.thText]}>Qty</Text>
        <Text style={[styles.cell, styles.thText]}>Unit</Text>
        <Text style={[styles.cell, styles.thText]}>Material</Text>
        <Text style={[styles.cell, styles.thText]}>Hrs</Text>
        <Text style={[styles.cell, styles.thText]}>Labor</Text>
        <Text style={[styles.cell, styles.thText]}>Total</Text>
      </View>
      {lines.map((l, i) => (
        <View style={styles.tr} key={i}>
          <Text style={styles.cellDesc}>{l.description ?? ''}</Text>
          <Text style={styles.cell}>{l.quantity ?? ''}</Text>
          <Text style={styles.cell}>{l.unit_cost != null ? money(l.unit_cost) : ''}</Text>
          <Text style={styles.cell}>{l.material_total ? money(l.material_total) : ''}</Text>
          <Text style={styles.cell}>{l.labor_hours ?? ''}</Text>
          <Text style={styles.cell}>{l.total_labor ? money(l.total_labor) : ''}</Text>
          <Text style={styles.cell}>{money(l.total_material_labor ?? 0)}</Text>
        </View>
      ))}
    </View>
  )
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text>{money(value)}</Text>
    </View>
  )
}

function DocPdf({ doc, lines }: { doc: PdfDoc; lines: PdfLine[] }) {
  const basic = lines.filter(l => l.section !== 'additional')
  const additional = lines.filter(l => l.section === 'additional')
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View>
          <Text style={styles.brand}>RPS — Rappahannock Petroleum</Text>
          <Text style={styles.brandSub}>Construction Department</Text>
        </View>

        <View style={styles.headerRow}>
          <View style={styles.block}>
            <Text style={styles.label}>Bill To</Text>
            <Text style={styles.value}>{doc.customerName ?? ''}</Text>
            {doc.attn ? <Text style={styles.value}>Attn: {doc.attn}</Text> : null}
            {doc.customerAddress ? <Text style={styles.value}>{doc.customerAddress}</Text> : null}
          </View>
          <View style={styles.block}>
            <Text style={styles.docTitle}>{doc.kind.toUpperCase()}</Text>
            <Text style={styles.rightLine}>{doc.number}</Text>
            {doc.date ? <Text style={styles.rightLine}>Date: {doc.date}</Text> : null}
            {doc.csrNumber ? <Text style={styles.rightLine}>CSR #: {doc.csrNumber}</Text> : null}
            {doc.poNumber ? <Text style={styles.rightLine}>PO #: {doc.poNumber}</Text> : null}
            {doc.dueDate ? <Text style={styles.rightLine}>Due: {doc.dueDate}</Text> : null}
            {doc.storeLabel ? <Text style={styles.rightLine}>{doc.storeLabel}</Text> : null}
            {doc.facilityAddress ? <Text style={styles.rightLine}>{doc.facilityAddress}</Text> : null}
            {doc.cityStateZip ? <Text style={styles.rightLine}>{doc.cityStateZip}</Text> : null}
          </View>
        </View>

        {doc.projectDescription ? (
          <View style={styles.desc}><Text>{doc.projectDescription}</Text></View>
        ) : null}

        <LineTable title="Basic Installation" lines={basic} />
        <LineTable title="Additional Scope" lines={additional} />

        <View style={styles.totals}>
          {basic.length ? <TotalRow label="Basic — Material" value={doc.basicSubtotalMaterial} /> : null}
          {basic.length ? <TotalRow label="Basic — Labor" value={doc.basicSubtotalLabor} /> : null}
          {basic.length ? <TotalRow label="Basic Total" value={doc.basicTotal} /> : null}
          {additional.length ? <TotalRow label="Additional — Material" value={doc.additionalSubtotalMaterial} /> : null}
          {additional.length ? <TotalRow label="Additional — Labor" value={doc.additionalSubtotalLabor} /> : null}
          {additional.length ? <TotalRow label="Additional Total" value={doc.additionalTotal} /> : null}
          <TotalRow label="Grand Total" value={doc.grandTotal} />
          <TotalRow label="Profit & Overhead" value={doc.profitOverheadAmount} />
          <TotalRow label="Sales Tax" value={doc.taxAmount} />
          <View style={styles.grand}>
            <Text style={styles.grandLabel}>{doc.kind === 'Invoice' ? 'Invoice Total' : 'Final Total'}</Text>
            <Text style={styles.grandValue}>{money(doc.finalTotal)}</Text>
          </View>
        </View>

        <View style={styles.sig}>
          <Text>{doc.preparedBy ?? 'Starsky Dodson, Construction Manager'}</Text>
          <Text style={{ color: '#9ca3af', marginTop: 2 }}>Construction Manager</Text>
          <Text style={{ color: '#9ca3af', marginTop: 8 }}>Date: ______________________</Text>
        </View>
      </Page>
    </Document>
  )
}

export async function renderDocPdf(doc: PdfDoc, lines: PdfLine[]): Promise<Buffer> {
  return renderToBuffer(<DocPdf doc={doc} lines={lines} />)
}
