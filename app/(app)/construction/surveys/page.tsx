import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { surveyTitle, SUMP_LABELS } from '@/lib/survey'
import { createSurvey } from './actions'

export const dynamic = 'force-dynamic'
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

export default async function SurveysPage() {
  const profile = await requireConstruction()
  const admin = createAdminClient()
  const [{ data: surveys }, { data: jobs }, { data: me }] = await Promise.all([
    admin.from('con_surveys').select('id, site_number, site_name, survey_date, tech_name, status, job_id, updated_at').eq('company_id', profile.company_id).order('updated_at', { ascending: false }).limit(60),
    admin.from('con_jobs').select('id, site_number, gas_brand, work_order_number, stage').eq('company_id', profile.company_id).neq('stage', 'complete').order('site_number'),
    admin.from('profiles').select('full_name, phone, email').eq('id', profile.id).single(),
  ])
  const counts = new Map<string, number>()
  if (surveys?.length) {
    const { data: sumps } = await admin.from('con_survey_sumps').select('survey_id').in('survey_id', surveys.map(s => s.id))
    for (const r of sumps ?? []) counts.set(r.survey_id, (counts.get(r.survey_id) ?? 0) + 1)
  }
  const STATUS: Record<string, string> = { draft: 'bg-[#FFC000] text-black', complete: 'bg-[#70AD47] text-white', sent: 'bg-[#385624] text-white' }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto overflow-x-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">Field Surveys</h1>
          <p className="text-sm text-gray-500 mt-0.5">ICON sump survey worksheets, filled on the phone, photos through the camera, PDF built here.</p>
        </div>
        <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide bg-gray-900 text-white">Surveys</div>
          {!surveys?.length ? <p className="p-4 text-sm text-gray-400">No surveys yet. Start one on the right.</p> : (
            <ul className="divide-y divide-gray-100">
              {surveys.map(sv => (
                <li key={sv.id}>
                  <Link href={`/construction/surveys/${sv.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[sv.status] ?? 'bg-gray-200'}`}>{sv.status}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{surveyTitle(sv)}</span>
                      <span className="block text-xs text-gray-500">{sv.survey_date} · {sv.tech_name ?? 'tech'} · {counts.get(sv.id) ?? 0} sump{(counts.get(sv.id) ?? 0) === 1 ? '' : 's'}</span>
                    </span>
                    <span className="text-xs text-blue-600">Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide bg-blue-700 text-white">New ICON sump survey</div>
          <form action={createSurvey} className="p-4 space-y-3">
            <div><label className={lbl}>Job (fills site and address)</label><select name="job_id" defaultValue="" className={inp}><option value="">— no job yet, type the site —</option>{(jobs ?? []).map(j => <option key={j.id} value={j.id}>{j.site_number}{j.gas_brand ? ` · ${j.gas_brand}` : ''}{j.work_order_number ? ` · ${j.work_order_number}` : ''}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>Site #</label><input name="site_number" placeholder="SU-8605" className={inp} /></div>
              <div><label className={lbl}>Brand / name</label><input name="site_name" placeholder="Sunoco" className={inp} /></div>
            </div>
            <div><label className={lbl}>Address</label><input name="address" className={inp} /></div>
            <div><label className={lbl}>First sump</label><input name="first_sump" list="first-sump" defaultValue="Dispenser 1/2 UDC" className={inp} /><datalist id="first-sump">{SUMP_LABELS.map(l => <option key={l} value={l} />)}</datalist></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>Date</label><input name="survey_date" type="date" defaultValue={new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })} className={inp} /></div>
              <div><label className={lbl}>Tech</label><input name="tech_name" defaultValue={me?.full_name ?? ''} className={inp} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>Tech phone</label><input name="tech_phone" defaultValue={me?.phone ?? ''} className={inp} /></div>
              <div><label className={lbl}>Tech email</label><input name="tech_email" defaultValue={me?.email ?? ''} className={inp} /></div>
            </div>
            <button className="w-full rounded-lg bg-blue-600 text-white py-2.5 text-sm font-semibold hover:bg-blue-700">Start survey</button>
          </form>
        </div>
      </div>
    </div>
  )
}
