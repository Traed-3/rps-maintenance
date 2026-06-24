'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  canWriteConstruction,
  computeDocumentTotals,
  type LineItemInput,
} from '@/lib/construction'

export type ActionState = { error: string } | null

// ── small parsers ───────────────────────────────────────────
function str(val: FormDataEntryValue | null) {
  const s = (val as string)?.trim()
  return s || null
}
function num(val: FormDataEntryValue | null): number | null {
  const s = (val as string)?.trim()
  if (!s) return null
  const v = Number(s.replace(/[$,]/g, ''))
  return isFinite(v) ? v : null
}
async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

// ============================================================
// CUSTOMERS
// ============================================================
export async function saveCustomer(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit customers.' }

  const name = str(formData.get('name'))
  if (!name) return { error: 'Customer name is required.' }

  const admin = createAdminClient()
  const fields = {
    name,
    billing_contact: str(formData.get('billing_contact')),
    email:           str(formData.get('email')),
    phone:           str(formData.get('phone')),
    billing_address: str(formData.get('billing_address')),
    notes:           str(formData.get('notes')),
  }

  let customerId = id
  if (id) {
    const { error } = await admin.from('con_customers').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await admin.from('con_customers')
      .insert({ ...fields, company_id: profile.company_id }).select('id').single()
    if (error) return { error: error.message }
    customerId = data!.id
  }

  revalidatePath('/construction/customers')
  redirect(`/construction/customers/${customerId}`)
}

export async function deleteCustomer(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  // Detach sites (keep the site rows; just unlink) then remove the customer.
  await admin.from('con_sites').update({ customer_id: null }).eq('customer_id', id).eq('company_id', profile.company_id)
  await admin.from('con_customers').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/customers')
  redirect('/construction/customers')
}

// ============================================================
// SITES
// ============================================================
export async function saveSite(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit sites.' }

  const site_number = str(formData.get('site_number'))
  if (!site_number) return { error: 'Site number / name is required.' }

  const admin = createAdminClient()
  const fields = {
    customer_id:     str(formData.get('customer_id')),
    site_number,
    store_brand:     str(formData.get('store_brand')),
    address:         str(formData.get('address')),
    city:            str(formData.get('city')),
    state:           str(formData.get('state')),
    zip:             str(formData.get('zip')),
    dispenser_count: num(formData.get('dispenser_count')),
    notes:           str(formData.get('notes')),
  }

  if (id) {
    const { error } = await admin.from('con_sites').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('con_sites').insert({ ...fields, company_id: profile.company_id })
    if (error) return { error: error.message }
  }

  const redirectTo = str(formData.get('redirect_to'))
  revalidatePath('/construction/customers')
  if (redirectTo) redirect(redirectTo)
  if (fields.customer_id) redirect(`/construction/customers/${fields.customer_id}`)
  redirect('/construction/customers')
}

export async function deleteSite(id: string, redirectTo?: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_sites').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/customers')
  if (redirectTo) redirect(redirectTo)
}

// ============================================================
// JOBS
// ============================================================
function jobFields(formData: FormData) {
  return {
    site_id:             str(formData.get('site_id')),
    site_number:         str(formData.get('site_number')),
    customer_id:         str(formData.get('customer_id')),
    work_order_number:   str(formData.get('work_order_number')),
    stage:               str(formData.get('stage')) ?? 'survey',
    status_detail:       str(formData.get('status_detail')),
    scope_of_work:       str(formData.get('scope_of_work')),
    facility_address:    str(formData.get('facility_address')),
    gas_brand:           str(formData.get('gas_brand')),
    program:             str(formData.get('program')),
    priority:            str(formData.get('priority')) ?? 'normal',
    date_received:       str(formData.get('date_received')),
    project_start_date:  str(formData.get('project_start_date')),
    response_time:       str(formData.get('response_time')),
    assigned_manager_id: str(formData.get('assigned_manager_id')),
    notes:               str(formData.get('notes')),
  }
}

export async function saveJob(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit jobs.' }

  const fields = jobFields(formData)
  if (!fields.site_number && !fields.site_id) return { error: 'A site number (or selected site) is required.' }

  const admin = createAdminClient()
  let jobId = id
  if (id) {
    const { error } = await admin.from('con_jobs').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await admin.from('con_jobs')
      .insert({ ...fields, company_id: profile.company_id }).select('id').single()
    if (error) return { error: error.message }
    jobId = data!.id
  }

  revalidatePath('/construction/jobs')
  revalidatePath('/construction')
  redirect(`/construction/jobs/${jobId}`)
}

/** Quick stage change from the kanban / detail header. */
export async function changeJobStage(id: string, stage: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_jobs').update({ stage }).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/jobs')
  revalidatePath('/construction')
  revalidatePath(`/construction/jobs/${id}`)
}

export async function deleteJob(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  // Child rows with ON DELETE CASCADE (materials, labor, closeout) go automatically;
  // quotes/invoices/schedule/documents keep their rows but null their job link.
  await admin.from('con_jobs').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/jobs')
  revalidatePath('/construction')
  redirect('/construction/jobs')
}

// ============================================================
// QUOTES & INVOICES — shared line-item parsing + recompute
// ============================================================
type LineRow = LineItemInput

/** Pull the line-item array out of a JSON field on the form. */
function parseLines(formData: FormData): LineRow[] {
  const raw = formData.get('line_items')
  if (!raw) return []
  try {
    const arr = JSON.parse(raw as string) as any[]
    return arr
      .map((r, i): LineRow => ({
        section: r.section === 'additional' ? 'additional' : 'basic',
        line_no: typeof r.line_no === 'number' ? r.line_no : i + 1,
        description: r.description?.toString().trim() || null,
        quantity: r.quantity != null && r.quantity !== '' ? Number(r.quantity) : null,
        unit_cost: r.unit_cost != null && r.unit_cost !== '' ? Number(r.unit_cost) : null,
        labor_hours: r.labor_hours != null && r.labor_hours !== '' ? Number(r.labor_hours) : null,
        labor_rate: r.labor_rate != null && r.labor_rate !== '' ? Number(r.labor_rate) : null,
        item_type: r.item_type?.toString().trim() || null,
        is_stock: !!r.is_stock,
      }))
      // drop fully empty rows
      .filter(r => r.description || r.quantity || r.unit_cost || r.labor_hours)
  } catch {
    return []
  }
}

function docHeaderFields(formData: FormData) {
  // percents arrive as whole numbers (6 = 6%); store as decimals
  const poPctRaw = num(formData.get('profit_overhead_percent')) ?? 0
  const taxPctRaw = num(formData.get('sales_tax_percent')) ?? 0
  return {
    job_id:              str(formData.get('job_id')),
    customer_id:         str(formData.get('customer_id')),
    project_description: str(formData.get('project_description')),
    store_label:         str(formData.get('store_label')),
    facility_address:    str(formData.get('facility_address')),
    city_state_zip:      str(formData.get('city_state_zip')),
    profit_overhead_percent: poPctRaw / 100,
    sales_tax_percent:       taxPctRaw / 100,
  }
}

export async function saveQuote(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit quotes.' }

  const admin = createAdminClient()
  const header = docHeaderFields(formData)
  const lines = parseLines(formData)
  const { totals, lines: computed } = computeDocumentTotals(lines, header.profit_overhead_percent, header.sales_tax_percent)

  const row = {
    ...header,
    company_id:    profile.company_id,
    attn:          str(formData.get('attn')),
    customer_email: str(formData.get('customer_email')),
    proposal_date: str(formData.get('proposal_date')),
    status:        str(formData.get('status')) ?? 'draft',
    prepared_by:   str(formData.get('prepared_by')) ?? 'Starsky Dodson, Construction Manager',
    sent_date:     str(formData.get('sent_date')),
    decision_date: str(formData.get('decision_date')),
    ...totals,
  }

  let quoteId = id
  if (id) {
    const { error } = await admin.from('con_quotes').update(row).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
    await admin.from('con_quote_line_items').delete().eq('quote_id', id)
  } else {
    const { data, error } = await admin.from('con_quotes').insert(row).select('id').single()
    if (error) return { error: error.message }
    quoteId = data!.id
  }

  if (computed.length) {
    const { error: liErr } = await admin.from('con_quote_line_items').insert(
      computed.map((l, i) => ({
        quote_id: quoteId,
        section: l.section,
        line_no: l.line_no ?? i + 1,
        description: l.description,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        material_total: l.material_total,
        labor_hours: l.labor_hours,
        labor_rate: l.labor_rate,
        total_labor: l.total_labor,
        total_material_labor: l.total_material_labor,
        item_type: l.item_type,
        is_stock: l.is_stock ?? false,
      }))
    )
    if (liErr) return { error: liErr.message }
  }

  revalidatePath('/construction/quotes')
  if (row.job_id) revalidatePath(`/construction/jobs/${row.job_id}`)
  redirect(`/construction/quotes/${quoteId}`)
}

export async function setQuoteStatus(id: string, status: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const updates: Record<string, unknown> = { status }
  if (status === 'sent') updates.sent_date = new Date().toISOString().split('T')[0]
  if (status === 'approved' || status === 'rejected') updates.decision_date = new Date().toISOString().split('T')[0]
  await admin.from('con_quotes').update(updates).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/quotes')
  revalidatePath(`/construction/quotes/${id}`)
}

export async function deleteQuote(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_quotes').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/quotes')
  redirect('/construction/quotes')
}

/** Copy an existing quote (header + line items) into a new draft invoice. */
export async function convertQuoteToInvoice(quoteId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()

  const { data: q } = await admin.from('con_quotes').select('*').eq('id', quoteId).eq('company_id', profile.company_id).single()
  if (!q) return
  const { data: items } = await admin.from('con_quote_line_items').select('*').eq('quote_id', quoteId)

  const { data: inv, error } = await admin.from('con_invoices').insert({
    company_id: profile.company_id,
    job_id: q.job_id,
    quote_id: q.id,
    invoice_date: new Date().toISOString().split('T')[0],
    customer_id: q.customer_id,
    attn: q.attn,
    store_label: q.store_label,
    facility_address: q.facility_address,
    city_state_zip: q.city_state_zip,
    project_description: q.project_description,
    profit_overhead_percent: q.profit_overhead_percent,
    sales_tax_percent: q.sales_tax_percent,
    basic_subtotal_material: q.basic_subtotal_material,
    basic_subtotal_labor: q.basic_subtotal_labor,
    basic_total: q.basic_total,
    additional_subtotal_material: q.additional_subtotal_material,
    additional_subtotal_labor: q.additional_subtotal_labor,
    additional_total: q.additional_total,
    grand_total: q.grand_total,
    profit_overhead_amount: q.profit_overhead_amount,
    tax_amount: q.tax_amount,
    invoice_grand_total: q.final_total,
    prepared_by: q.prepared_by,
    status: 'draft',
  }).select('id').single()
  if (error || !inv) return

  if (items?.length) {
    await admin.from('con_invoice_line_items').insert(
      items.map(it => ({
        invoice_id: inv.id,
        section: it.section,
        line_no: it.line_no,
        description: it.description,
        quantity: it.quantity,
        unit_cost: it.unit_cost,
        material_total: it.material_total,
        labor_hours: it.labor_hours,
        labor_rate: it.labor_rate,
        total_labor: it.total_labor,
        total_material_labor: it.total_material_labor,
        item_type: it.item_type,
        is_stock: it.is_stock,
      }))
    )
  }

  revalidatePath('/construction/invoices')
  redirect(`/construction/invoices/${inv.id}`)
}

export async function saveInvoice(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit invoices.' }

  const admin = createAdminClient()
  const header = docHeaderFields(formData)
  const lines = parseLines(formData)
  const { totals, lines: computed } = computeDocumentTotals(lines, header.profit_overhead_percent, header.sales_tax_percent)

  const { final_total, ...totalsRest } = totals
  const row = {
    ...header,
    company_id:   profile.company_id,
    quote_id:     str(formData.get('quote_id')),
    invoice_date: str(formData.get('invoice_date')),
    csr_number:   str(formData.get('csr_number')),
    po_number:    str(formData.get('po_number')),
    attn:         str(formData.get('attn')),
    status:       str(formData.get('status')) ?? 'draft',
    prepared_by:  str(formData.get('prepared_by')) ?? 'Starsky Dodson, Construction Manager',
    sent_date:    str(formData.get('sent_date')),
    due_date:     str(formData.get('due_date')),
    paid_date:    str(formData.get('paid_date')),
    ...totalsRest,
    invoice_grand_total: final_total,
  }

  let invoiceId = id
  if (id) {
    const { error } = await admin.from('con_invoices').update(row).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
    await admin.from('con_invoice_line_items').delete().eq('invoice_id', id)
  } else {
    const { data, error } = await admin.from('con_invoices').insert(row).select('id').single()
    if (error) return { error: error.message }
    invoiceId = data!.id
  }

  if (computed.length) {
    const { error: liErr } = await admin.from('con_invoice_line_items').insert(
      computed.map((l, i) => ({
        invoice_id: invoiceId,
        section: l.section,
        line_no: l.line_no ?? i + 1,
        description: l.description,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        material_total: l.material_total,
        labor_hours: l.labor_hours,
        labor_rate: l.labor_rate,
        total_labor: l.total_labor,
        total_material_labor: l.total_material_labor,
        item_type: l.item_type,
        is_stock: l.is_stock ?? false,
      }))
    )
    if (liErr) return { error: liErr.message }
  }

  revalidatePath('/construction/invoices')
  if (row.job_id) revalidatePath(`/construction/jobs/${row.job_id}`)
  redirect(`/construction/invoices/${invoiceId}`)
}

export async function setInvoiceStatus(id: string, status: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const updates: Record<string, unknown> = { status }
  if (status === 'sent') updates.sent_date = today
  if (status === 'paid') updates.paid_date = today
  await admin.from('con_invoices').update(updates).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/invoices')
  revalidatePath(`/construction/invoices/${id}`)
}

export async function deleteInvoice(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_invoices').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/invoices')
  redirect('/construction/invoices')
}

// ============================================================
// JOB MATERIALS
// ============================================================
export async function saveMaterial(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit materials.' }

  const job_id = str(formData.get('job_id'))
  if (!job_id) return { error: 'Material must belong to a job.' }
  const description = str(formData.get('description'))
  if (!description) return { error: 'Description is required.' }

  const admin = createAdminClient()
  const fields = {
    job_id,
    item_number:  str(formData.get('item_number')),
    part_number:  str(formData.get('part_number')),
    description,
    quantity:     num(formData.get('quantity')),
    unit_cost:    num(formData.get('unit_cost')),
    status:       str(formData.get('status')) ?? 'needed',
    vendor:       str(formData.get('vendor')),
    ordered_date: str(formData.get('ordered_date')),
    received_date: str(formData.get('received_date')),
    notes:        str(formData.get('notes')),
  }

  if (id) {
    const { error } = await admin.from('con_job_materials').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('con_job_materials').insert({ ...fields, company_id: profile.company_id })
    if (error) return { error: error.message }
  }

  revalidatePath('/construction/materials')
  revalidatePath(`/construction/jobs/${job_id}`)
  return null
}

export async function setMaterialStatus(id: string, status: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const updates: Record<string, unknown> = { status }
  if (status === 'ordered') updates.ordered_date = today
  if (status === 'received') updates.received_date = today
  await admin.from('con_job_materials').update(updates).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/materials')
}

export async function deleteMaterial(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_job_materials').select('job_id').eq('id', id).single()
  await admin.from('con_job_materials').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/materials')
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

// ============================================================
// SCHEDULE ENTRIES
// ============================================================
export async function saveScheduleEntry(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit the schedule.' }

  const schedule_date = str(formData.get('schedule_date'))
  if (!schedule_date) return { error: 'A date is required.' }

  // crew arrives as a comma/space separated string → text[]
  const crewRaw = str(formData.get('crew'))
  const crew = crewRaw ? crewRaw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) : null

  const entryTypeRaw = str(formData.get('entry_type'))
  const entry_type = ['job', 'time_off', 'note'].includes(entryTypeRaw ?? '') ? entryTypeRaw : 'job'

  const admin = createAdminClient()
  const fields = {
    schedule_date,
    entry_type,
    job_id:           entry_type === 'job' ? str(formData.get('job_id')) : null,
    site_number:      str(formData.get('site_number')),
    task_description: str(formData.get('task_description')),
    crew,
    equipment:        str(formData.get('equipment')),
    notes:            str(formData.get('notes')),
  }

  if (id) {
    const { error } = await admin.from('con_schedule_entries').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('con_schedule_entries').insert({ ...fields, company_id: profile.company_id })
    if (error) return { error: error.message }
  }

  revalidatePath('/construction/schedule')
  return null
}

export async function moveScheduleEntry(id: string, schedule_date: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_schedule_entries').update({ schedule_date }).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/schedule')
}

export async function deleteScheduleEntry(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_schedule_entries').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/schedule')
}

export async function toggleChecklistItem(id: string, done: boolean): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_checklist_items').update({ done }).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/checklist')
}

// ============================================================
// CLOSE-OUT TASKS
// ============================================================
const DEFAULT_CLOSEOUT_TASKS = [
  'Intercom working', 'Iso relays', 'Pump toppers', 'Data disconnect',
  'Dispensers caulked', 'Disp pics & closeout', 'Invoice sent', 'Punchlist',
]

export async function seedCloseoutTasks(jobId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { count } = await admin.from('con_closeout_tasks')
    .select('*', { count: 'exact', head: true }).eq('job_id', jobId)
  if ((count ?? 0) > 0) return
  await admin.from('con_closeout_tasks').insert(
    DEFAULT_CLOSEOUT_TASKS.map(task_name => ({ company_id: profile.company_id, job_id: jobId, task_name }))
  )
  revalidatePath(`/construction/jobs/${jobId}`)
}

export async function addCloseoutTask(jobId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }
  const task_name = str(formData.get('task_name'))
  if (!task_name) return { error: 'Task name is required.' }
  const admin = createAdminClient()
  await admin.from('con_closeout_tasks').insert({ company_id: profile.company_id, job_id: jobId, task_name })
  revalidatePath(`/construction/jobs/${jobId}`)
  return null
}

export async function toggleCloseoutTask(id: string, isComplete: boolean): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', profile.id).single()
  await admin.from('con_closeout_tasks').update({
    is_complete: isComplete,
    completed_by: isComplete ? (me?.full_name ?? null) : null,
    completed_date: isComplete ? new Date().toISOString().split('T')[0] : null,
  }).eq('id', id).eq('company_id', profile.company_id)
  const { data } = await admin.from('con_closeout_tasks').select('job_id').eq('id', id).single()
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

export async function deleteCloseoutTask(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_closeout_tasks').select('job_id').eq('id', id).single()
  await admin.from('con_closeout_tasks').delete().eq('id', id).eq('company_id', profile.company_id)
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

// ============================================================
// JOB LABOR (manual log for job-cost)
// ============================================================
export async function addJobLabor(jobId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }
  const hours = num(formData.get('hours'))
  if (hours == null) return { error: 'Hours are required.' }
  const admin = createAdminClient()
  await admin.from('con_job_labor').insert({
    company_id: profile.company_id,
    job_id: jobId,
    work_date: str(formData.get('work_date')),
    crew_member: str(formData.get('crew_member')),
    hours,
    labor_rate: num(formData.get('labor_rate')),
    task_note: str(formData.get('task_note')),
  })
  revalidatePath(`/construction/jobs/${jobId}`)
  return null
}

export async function deleteJobLabor(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_job_labor').select('job_id').eq('id', id).single()
  await admin.from('con_job_labor').delete().eq('id', id).eq('company_id', profile.company_id)
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

// ============================================================
// DOCUMENTS
// ============================================================
export async function deleteDocument(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data: doc } = await admin.from('con_documents')
    .select('job_id, storage_path').eq('id', id).eq('company_id', profile.company_id).single()
  if (doc?.storage_path) {
    await admin.storage.from('construction-docs').remove([doc.storage_path])
  }
  await admin.from('con_documents').delete().eq('id', id).eq('company_id', profile.company_id)
  if (doc?.job_id) revalidatePath(`/construction/jobs/${doc.job_id}`)
}
