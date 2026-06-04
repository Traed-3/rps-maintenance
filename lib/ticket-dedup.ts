/**
 * Duplicate-ticket detection.
 *
 * Compares a proposed ticket title against the OPEN tickets already on the same
 * asset and decides whether they describe the same problem — so we don't create
 * (or can clean up) two tickets for one issue. The earliest ticket is the keeper.
 */

import { createAdminClient } from '@/lib/supabase/admin'

// Generic words that don't help distinguish one problem from another
const STOP = new Set([
  'the','a','an','and','or','of','to','in','on','at','is','are','was','were','be','it','its',
  'for','with','this','that','these','those','from','by','as','not','no','out','off','up','down',
  'needs','need','needed','please','repair','repaired','replace','replacement','service','serviced',
  'issue','issues','problem','problems','again','still','truck','unit','asset','va','rps','due','get',
])

export function titleTokens(title: string, unitNumber?: string | null): Set<string> {
  let s = (title || '').toLowerCase()
  if (unitNumber) s = s.split(unitNumber.toLowerCase()).join(' ')
  s = s.replace(/—.*$/, ' ')          // drop a trailing "— UNIT" label
  s = s.replace(/[^a-z0-9]+/g, ' ')
  const toks = s.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))
  return new Set(toks)
}

/** True if two titles describe the same problem. */
export function titlesAreSimilar(a: string, b: string, unit?: string | null): boolean {
  const A = titleTokens(a, unit)
  const B = titleTokens(b, unit)
  if (!A.size || !B.size) return false
  const inter = [...A].filter((x) => B.has(x))
  const union = new Set([...A, ...B])
  const jaccard = inter.length / union.size
  const minSize = Math.min(A.size, B.size)
  const subset = inter.length === minSize            // all of the smaller title is inside the larger
  return jaccard >= 0.5 || (subset && minSize >= 2)
}

/** Return an existing OPEN ticket on the same asset that looks like the same problem. */
export async function findSimilarOpenTicket(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  assetId: string,
  title: string,
  excludeId?: string
): Promise<{ id: string; ticket_number: string; title: string } | null> {
  const { data } = await admin
    .from('repair_tickets')
    .select('id, ticket_number, title, created_at')
    .eq('company_id', companyId)
    .eq('asset_id', assetId)
    .not('status', 'in', '(closed,completed,deferred)')
    .order('created_at', { ascending: true })   // earliest first = the keeper

  for (const t of data ?? []) {
    if (excludeId && t.id === excludeId) continue
    if (titlesAreSimilar(title, t.title)) {
      return { id: t.id, ticket_number: t.ticket_number, title: t.title }
    }
  }
  return null
}
