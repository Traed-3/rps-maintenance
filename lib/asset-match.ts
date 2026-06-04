/**
 * Fuzzy asset matching — given a unit number detected from an email subject
 * that did NOT match any asset exactly, suggest the closest existing assets.
 */

export type AssetLite = { id: string; unit_number: string; status?: string | null }
export type Suggestion = { id: string; unit_number: string; score: number; reason: string }

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const prev = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(
        prev[j] + 1,          // deletion
        prev[j - 1] + 1,      // insertion
        diag + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      )
      diag = tmp
    }
  }
  return prev[n]
}

export function suggestAssets(detectedRaw: string, assets: AssetLite[], limit = 3): Suggestion[] {
  const detected = (detectedRaw || '').toUpperCase().trim()
  if (!detected) return []
  const isDigits = /^\d+$/.test(detected)
  const noLead = detected.replace(/^0+/, '')

  const scored: Suggestion[] = assets.map((a) => {
    const u = (a.unit_number || '').toUpperCase()
    let score = 0
    let reason = 'similar'

    if (u === detected) {
      score = 100; reason = 'exact match'
    } else if (isDigits && (u === 'T' + detected || u === 'T' + noLead)) {
      score = 96; reason = `trailer T${noLead}`
    } else if (isDigits && (u === 'E' + detected || u === 'E' + noLead)) {
      score = 96; reason = `equipment E${noLead}`
    } else if (isDigits && /^[TE]/.test(u) && (u.endsWith(detected) || u.endsWith(noLead))) {
      score = 86; reason = `ends in ${noLead}`
    } else if (u.startsWith(detected) || detected.startsWith(u)) {
      score = 80; reason = 'starts the same'
    } else if (u.includes(detected) || detected.includes(u)) {
      score = 70; reason = 'contains it'
    } else {
      const d = levenshtein(u, detected)
      const maxLen = Math.max(u.length, detected.length) || 1
      score = Math.round((1 - d / maxLen) * 60)
      reason = 'looks close'
    }
    return { id: a.id, unit_number: a.unit_number, score, reason }
  })

  return scored
    .filter((s) => s.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
