import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadConstruction, fmtDate } from '@/lib/construction'
import { renderDocPdf, type PdfLine } from '@/lib/construction-pdf'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile || !canReadConstruction(profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: inv } = await admin
    .from('con_invoices').select('*, con_customers(name, billing_address)')
    .eq('id', id).eq('company_id', profile.company_id).single()
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: items } = await admin
    .from('con_invoice_line_items').select('*').eq('invoice_id', id).order('section').order('line_no')

  const lines: PdfLine[] = (items ?? []).map(it => ({
    section: it.section, description: it.description, quantity: it.quantity, unit_cost: it.unit_cost,
    material_total: it.material_total, labor_hours: it.labor_hours, labor_rate: it.labor_rate,
    total_labor: it.total_labor, total_material_labor: it.total_material_labor,
  }))

  const pdf = await renderDocPdf({
    kind: 'Invoice',
    number: inv.invoice_number ?? 'DRAFT',
    date: inv.invoice_date ? fmtDate(inv.invoice_date) : null,
    customerName: (inv as any).con_customers?.name ?? null,
    attn: inv.attn,
    customerAddress: (inv as any).con_customers?.billing_address ?? null,
    storeLabel: inv.store_label,
    facilityAddress: inv.facility_address,
    cityStateZip: inv.city_state_zip,
    csrNumber: inv.csr_number,
    poNumber: inv.po_number,
    dueDate: inv.due_date ? fmtDate(inv.due_date) : null,
    projectDescription: inv.project_description,
    basicSubtotalMaterial: Number(inv.basic_subtotal_material) || 0,
    basicSubtotalLabor: Number(inv.basic_subtotal_labor) || 0,
    basicTotal: Number(inv.basic_total) || 0,
    additionalSubtotalMaterial: Number(inv.additional_subtotal_material) || 0,
    additionalSubtotalLabor: Number(inv.additional_subtotal_labor) || 0,
    additionalTotal: Number(inv.additional_total) || 0,
    grandTotal: Number(inv.grand_total) || 0,
    profitOverheadAmount: Number(inv.profit_overhead_amount) || 0,
    taxAmount: Number(inv.tax_amount) || 0,
    finalTotal: Number(inv.invoice_grand_total) || 0,
    preparedBy: inv.prepared_by,
  }, lines)

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${inv.invoice_number ?? 'invoice'}.pdf"`,
    },
  })
}
