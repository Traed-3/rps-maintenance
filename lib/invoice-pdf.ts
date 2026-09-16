import type { createAdminClient } from '@/lib/supabase/admin'
import { fmtDate } from '@/lib/billing'
import { renderDocPdf, type PdfLine } from '@/lib/construction-pdf'

type Admin = ReturnType<typeof createAdminClient>

/** Render an invoice to PDF bytes. Shared by the download route and the email-out action. */
export async function buildInvoicePdf(admin: Admin, id: string, company_id: string) {
  const { data: inv } = await admin.from('con_invoices').select('*, con_customers(name, billing_address, email, billing_contact)').eq('id', id).eq('company_id', company_id).single()
  if (!inv) return null
  const customer = (inv as unknown as { con_customers: { name: string; billing_address: string | null; email: string | null; billing_contact: string | null } | null }).con_customers
  const { data: items } = await admin.from('con_invoice_line_items').select('*').eq('invoice_id', id).order('section').order('line_no')

  const lines: PdfLine[] = (items ?? []).map(it => ({
    section: it.section, description: it.description, quantity: it.quantity, unit_cost: it.unit_cost,
    material_total: it.material_total, labor_hours: it.labor_hours, labor_rate: it.labor_rate,
    total_labor: it.total_labor, total_material_labor: it.total_material_labor,
  }))

  const pdf = await renderDocPdf({
    kind: 'Invoice',
    number: inv.invoice_number ?? 'DRAFT',
    date: inv.invoice_date ? fmtDate(inv.invoice_date) : null,
    customerName: customer?.name ?? null,
    attn: inv.attn,
    customerAddress: customer?.billing_address ?? null,
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

  return { pdf, invoice: inv, customer }
}
