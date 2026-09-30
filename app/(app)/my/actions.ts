'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const KINDS = new Set(['quote', 'price', 'order', 'bid', 'survey', 'followup', 'admin'])

async function me() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id').eq('id', user.id).single()
  if (!profile) throw new Error('No profile')
  return { admin, id: profile.id as string, company_id: profile.company_id as string }
}

function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) }
function str(v: FormDataEntryValue | null) { const s = (v as string | null)?.trim(); return s || null }

/** Only my own row can change. */
async function mine(admin: ReturnType<typeof createAdminClient>, id: string, owner: string) {
  const { data } = await admin.from('con_tasks').select('id').eq('id', id).eq('owner_id', owner).maybeSingle()
  if (!data) throw new Error('Not your task')
}

export async function addTask(formData: FormData): Promise<void> {
  const { admin, id, company_id } = await me()
  const title = str(formData.get('title'))
  if (!title) return
  const kind = str(formData.get('kind')) ?? 'followup'
  const priority = Number(formData.get('priority') ?? 2)
  const source_key = str(formData.get('source_key'))
  const row = {
    company_id, owner_id: id, title, detail: str(formData.get('detail')), kind: KINDS.has(kind) ? kind : 'followup',
    site_number: str(formData.get('site_number')), due_date: str(formData.get('due_date')),
    priority: [1, 2, 3].includes(priority) ? priority : 2, source: source_key ? 'signal' : 'manual', source_key,
  }
  const q = source_key
    ? admin.from('con_tasks').upsert(row, { onConflict: 'company_id,owner_id,source_key' })
    : admin.from('con_tasks').insert(row)
  const { error } = await q
  if (error) throw new Error(error.message)
  revalidatePath('/my')
}

export async function completeTask(id: string): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  await admin.from('con_tasks').update({ status: 'done', done_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function reopenTask(id: string): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  await admin.from('con_tasks').update({ status: 'open', done_at: null, waiting_on: null, waiting_since: null, snoozed_until: null, updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function dropTask(id: string): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  await admin.from('con_tasks').update({ status: 'dropped', updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

/** Hand it to someone: the row moves to "Waiting on" with their name and today's date. */
export async function waitTask(id: string, formData: FormData): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  const who = str(formData.get('who'))
  if (!who) return
  await admin.from('con_tasks').update({ status: 'waiting', waiting_on: who, waiting_since: today(), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function snoozeTask(id: string, formData: FormData): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  const days = Number(formData.get('days') ?? 1)
  const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (days > 0 ? days : 1))
  await admin.from('con_tasks').update({ snoozed_until: d.toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function setPriority(id: string, formData: FormData): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  const p = Number(formData.get('priority'))
  if (![1, 2, 3].includes(p)) return
  await admin.from('con_tasks').update({ priority: p, updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function setDue(id: string, formData: FormData): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  await admin.from('con_tasks').update({ due_date: str(formData.get('due_date')), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}
