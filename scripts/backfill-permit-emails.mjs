#!/usr/bin/env node
/**
 * One-time backfill: find permit-issuance emails already sitting in
 * econstruction.rp@gmail.com (now connected via GMAIL_TOKEN_ECONSTRUCTION)
 * for the Dispenser Replacement rollout, file the PDF as a
 * con_permit_deliverables row, and link the site's permit project to its
 * Construction job (lib/permit-job-link.ts's rule, reimplemented here in
 * plain JS — see scripts/link-permits-to-jobs.mjs for the same pattern).
 *
 * NEEDS FROM TRAE BEFORE RUNNING (see PLAN.md / the SITES array below):
 *   - the actual site-number list for the rollout
 *   - typical subject-line phrasing for a permit-issuance email at the time
 *     (search reliability depends on this — refine SEARCH_TERMS below)
 *   - what to do when a match has no PDF attached (permit texted/mailed
 *     instead) — this script just logs those and moves on, does nothing
 *
 * Also needs GMAIL_TOKEN_ECONSTRUCTION (+ GMAIL_CLIENT_ID/SECRET) in
 * .env.local for a LOCAL run — same token already in Vercel, minted the
 * same way (see scripts/refresh-gmail-token.mjs for the walkthrough).
 *
 *   node scripts/backfill-permit-emails.mjs            # dry run
 *   node scripts/backfill-permit-emails.mjs --apply    # write
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')
const BUCKET = 'construction-docs'

// ── TODO: fill in from Trae — the Dispenser Replacement rollout site list ──
const SITES = []

// ── TODO: refine once Trae confirms typical subject phrasing for the period ──
const SEARCH_TERMS = '(permit OR "permit issued" OR "permit approved" OR "electrical permit")'

const refreshToken = env.GMAIL_TOKEN_ECONSTRUCTION
if (!refreshToken) { console.error('No GMAIL_TOKEN_ECONSTRUCTION in .env.local — mint one the same way as the other GMAIL_TOKEN_* vars (OAuth Playground, gmail.readonly, signed in as econstruction.rp@gmail.com) and add it locally before running this.'); process.exit(1) }

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
let access = null
async function token() {
  if (access) return access
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET }) })
  const d = await r.json(); if (d.error) throw new Error(`token: ${d.error} ${d.error_description || ''}`)
  return (access = d.access_token)
}
async function api(path, params = {}) {
  const u = new URL(`${API}${path}`); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v))
  const r = await fetch(u, { headers: { Authorization: `Bearer ${await token()}` } })
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`)
  return r.json()
}
function walkAttachments(part, out = []) {
  if (part.filename && part.body?.attachmentId) out.push({ id: part.body.attachmentId, filename: part.filename, mime: part.mimeType })
  ;(part.parts || []).forEach(p => walkAttachments(p, out)); return out
}
const safe = s => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)

async function findOrCreateJob(companyId, site, project) {
  const { data: openJobs } = await sb.from('con_jobs')
    .select('id, job_number, stage').eq('company_id', companyId).eq('site_number', site.site_number).neq('stage', 'complete')
  if (openJobs?.length === 1) {
    await sb.from('con_permit_projects').update({ job_id: openJobs[0].id }).eq('id', project.id)
    return `linked to job ${openJobs[0].job_number ?? openJobs[0].id}`
  }
  if (openJobs?.length > 1) return `AMBIGUOUS — ${openJobs.length} open jobs, resolve on the site's permit page`
  const facilityAddress = [site.address, site.city, site.state].filter(Boolean).join(', ') || null
  const { data: job, error } = await sb.from('con_jobs').insert({
    company_id: companyId, site_number: site.site_number, stage: 'permitting',
    facility_address: facilityAddress, gas_brand: site.brand ?? null,
    notes: `Started from permit project — ${project.project_type}`,
  }).select('id').single()
  if (error || !job) return `ERROR creating job: ${error?.message}`
  await sb.from('con_permit_projects').update({ job_id: job.id }).eq('id', project.id)
  return `created job ${job.id}`
}

async function main() {
  if (!SITES.length) { console.error('SITES is empty — fill in the rollout site-number list at the top of this script before running.'); process.exit(1) }

  let matched = 0, noEmail = 0, noPdf = 0, filed = 0, alreadyFiled = 0, errors = 0

  for (const siteNumber of SITES) {
    const { data: site } = await sb.from('con_permit_sites').select('*').eq('site_number', siteNumber).maybeSingle()
    if (!site) { console.log(`${siteNumber}: no con_permit_sites record — skipping`); continue }

    const { data: msgs } = await api('/messages', { q: `${siteNumber} ${SEARCH_TERMS}`, maxResults: '25' })
    if (!msgs.messages?.length) { console.log(`${siteNumber}: no matching email found`); noEmail++; continue }

    let sitePdfFound = false
    for (const m of msgs.messages) {
      const full = await api(`/messages/${m.id}`, { format: 'full' })
      const headers = Object.fromEntries((full.payload.headers || []).map(x => [x.name.toLowerCase(), x.value]))
      const atts = walkAttachments(full.payload).filter(a => /pdf/i.test(a.mime) || /\.pdf$/i.test(a.filename))
      if (!atts.length) continue
      sitePdfFound = true
      matched++

      for (const a of atts) {
        const { data: existing } = await sb.from('con_permit_deliverables')
          .select('id').eq('site_id', site.id).eq('filename', a.filename).maybeSingle()
        if (existing) { console.log(`${siteNumber}: ${a.filename} already filed — skipping`); alreadyFiled++; continue }

        const date = new Date(Number(full.internalDate)).toISOString().slice(0, 10)
        console.log(`${siteNumber}: found "${headers.subject}" (${date}) — ${a.filename}`)
        if (!APPLY) continue

        const d = await api(`/messages/${m.id}/attachments/${a.id}`)
        const buf = Buffer.from(d.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        const storagePath = `${site.company_id}/permits/${site.id}/${Date.now()}-${safe(a.filename)}`
        const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buf, { contentType: a.mime, upsert: true })
        if (upErr) { console.log(`    ERROR uploading: ${upErr.message}`); errors++; continue }

        const { error: insErr } = await sb.from('con_permit_deliverables').insert({
          company_id: site.company_id, site_id: site.id, created_date: date,
          type: 'Issued Permit', filename: a.filename, storage_path: storagePath,
          where_it_lives: 'Gmail — econstruction.rp (auto-filed)',
        })
        if (insErr) { console.log(`    ERROR filing: ${insErr.message}`); errors++; continue }
        filed++

        const { data: project } = await sb.from('con_permit_projects').select('id, project_type').eq('site_id', site.id).limit(1).maybeSingle()
        if (project) console.log(`    ${await findOrCreateJob(site.company_id, site, project)}`)
        else console.log('    no permit project at this site yet — filed the deliverable but skipped the job link')
      }
    }
    if (!sitePdfFound) { console.log(`${siteNumber}: email(s) found but no PDF attached — permit was likely texted/mailed instead`); noPdf++ }
  }

  console.log(`\n${matched} email(s) with a PDF matched, ${filed} filed, ${alreadyFiled} already filed, ${noEmail} sites with no matching email, ${noPdf} sites with email but no PDF, ${errors} error(s).`)
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write these changes.')
}

main()
