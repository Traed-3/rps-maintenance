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
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadConstruction(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: q } = await admin
    .from('con_quotes').select('*, con_customers(name, billing_address)')
    .eq('id', id).eq('company_id', profile.company_id).single()
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: items } = await admin
    .from('con_quote_line_items').select('*').eq('quote_id', id).order('section').order('line_no')

  const lines: PdfLine[] = (items ?? []).map(it => ({
    section: it.section, description: it.description, quantity: it.quantity, unit_cost: it.unit_cost,
    material_total: it.material_total, labor_hours: it.labor_hours, labor_rate: it.labor_rate,
    total_labor: it.total_labor, total_material_labor: it.total_material_labor,
  }))

  const pdf = await renderDocPdf({
    kind: 'Proposal',
    number: q.quote_number ?? 'DRAFT',
    date: q.proposal_date ? fmtDate(q.proposal_date) : null,
    customerName: (q as any).con_customers?.name ?? null,
    attn: q.attn,
    customerAddress: (q as any).con_customers?.billing_address ?? null,
    storeLabel: q.store_label,
    facilityAddress: q.facility_address,
    cityStateZip: q.city_state_zip,
    projectDescription: q.project_description,
    basicSubtotalMaterial: Number(q.basic_subtotal_material) || 0,
    basicSubtotalLabor: Number(q.basic_subtotal_labor) || 0,
    basicTotal: Number(q.basic_total) || 0,
    additionalSubtotalMaterial: Number(q.additional_subtotal_material) || 0,
    additionalSubtotalLabor: Number(q.additional_subtotal_labor) || 0,
    additionalTotal: Number(q.additional_total) || 0,
    grandTotal: Number(q.grand_total) || 0,
    profitOverheadAmount: Number(q.profit_overhead_amount) || 0,
    taxAmount: Number(q.tax_amount) || 0,
    finalTotal: Number(q.final_total) || 0,
    preparedBy: q.prepared_by,
  }, lines)

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${q.quote_number ?? 'quote'}.pdf"`,
    },
  })
}
