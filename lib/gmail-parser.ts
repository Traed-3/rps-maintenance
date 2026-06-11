/**
 * Gmail email parsing utilities:
 * - Extract unit number and title from subject
 * - Extract plain-text body from MIME parts
 * - Detect status keywords in email text
 * - Extract sender name and email
 */

// ── Subject parsing ───────────────────────────────────────────────────────────

export interface ParsedSubject {
  unitNumber: string   // e.g. "T20", "BC4", "PVPW"
  title: string        // rest of subject after unit number
  raw: string
}

export function parseSubject(subject: string): ParsedSubject {
  const trimmed = subject.trim()
  const parts = trimmed.split(/\s+/)
  const unitNumber = parts[0]?.toUpperCase() ?? 'UNKNOWN'
  const title = parts.slice(1).join(' ') || trimmed
  return { unitNumber, title, raw: trimmed }
}

// ── Asset unit-number candidates (anywhere in the subject) ────────────────────

// Shop convention puts the unit first ("T20 brakes sound bad"), but some emails
// bury it ("Breaks sound bad on t20"). These regexes pull every token that
// *looks* like a unit number from anywhere in the subject. The caller then
// validates them against real assets, so being liberal here is safe — a token
// that isn't a real unit (F250, O2, 4x4…) simply doesn't match anything.
const UNIT_TOKEN = /\b[A-Za-z]{1,3}\d{1,4}[A-Za-z]?\b/g   // T20, P16, GG7, I9, NN14, L12A…
const PV_TOKEN   = /\b[A-Za-z]{2,4}PV\b/gi                 // personal vehicles: PWPV, SPPV…

/** Every unit-number-looking token in the subject, uppercased, in order, deduped. */
export function extractUnitCandidates(subject: string): string[] {
  if (!subject) return []
  const seen = new Set<string>()
  const out: string[] = []
  const push = (tok: string) => {
    const u = tok.toUpperCase()
    if (!seen.has(u)) { seen.add(u); out.push(u) }
  }
  // Split on commas/slashes too so "S19,II9,J10" yields separate tokens
  const normalized = subject.replace(/[/,]+/g, ' ')
  for (const m of normalized.matchAll(UNIT_TOKEN)) push(m[0])
  for (const m of normalized.matchAll(PV_TOKEN))   push(m[0])
  // Collapse runs of single chars typed with spaces ("I I 9" → "II9", "T 20" → "T20")
  // so a unit broken up by spaces still resolves. Validated against real assets,
  // so the occasional bogus join (e.g. "a b c") simply matches nothing.
  const toks = normalized.split(/\s+/)
  let i = 0
  while (i < toks.length) {
    if (/^[A-Za-z0-9]$/.test(toks[i])) {
      let j = i
      while (j < toks.length && /^[A-Za-z0-9]$/.test(toks[j])) j++
      if (j - i >= 2) push(toks.slice(i, j).join(''))
      i = j
    } else i++
  }
  return out
}

/** Build a clean ticket title by removing a matched unit token from the subject. */
export function titleWithoutUnit(subject: string, unit: string): string {
  if (!subject) return ''
  const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let t = subject.replace(new RegExp(`\\b${escaped}\\b`, 'i'), ' ')
  t = t.replace(/^\s*(re|fwd)\s*:\s*/gi, '')               // drop "Re:" / "Fwd:" prefixes
  t = t.replace(/\s*,\s*(?=,|$)/g, '')                     // collapse "x,,y" and trailing commas
  t = t.replace(/\s{2,}/g, ' ').trim()
  t = t.replace(/^[\s\-:,]+|[\s\-:,]+$/g, '').trim()       // stray leading/trailing punctuation
  t = t.replace(/\s+(on|for|at|to|in|of|the)$/i, '').trim() // dangling connector left behind
  return t || subject.trim()
}

// ── Body extraction ───────────────────────────────────────────────────────────

/**
 * Strip HTML tags + decode common entities so email bodies don't carry raw
 * markup into ticket notes. Safe to run on plain text too (no-op if no tags).
 */
export function stripHtml(input: string): string {
  if (!input) return ''
  let s = input
  // Drop style/script blocks entirely
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // Turn block-level tags / breaks into newlines
  s = s.replace(/<\s*br\s*\/?>/gi, '\n')
  s = s.replace(/<\/\s*(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, '\n')
  // Remove inline image/file placeholders like <IMG_1234.jpeg>
  s = s.replace(/<[^>\s]+\.(jpe?g|png|heic|gif|pdf)>/gi, '')
  // Remove all remaining well-formed tags
  s = s.replace(/<[^>]+>/g, '')
  // Remove a dangling/truncated tag at the very end (no closing '>')
  s = s.replace(/<\s*\/?[a-zA-Z][^\n>]*$/g, '')
  // Decode the handful of entities that show up in real emails
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&[#a-z0-9]+;/gi, '')
  // Tidy whitespace
  s = s.replace(/\r/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

function decode(b64?: string): string {
  if (!b64) return ''
  try { return Buffer.from(b64, 'base64url').toString('utf-8') } catch { return '' }
}

/** Recursively collect the first body of a given mime type. */
function findPart(payload: any, mime: string): string {
  if (!payload) return ''
  if (payload.mimeType === mime && payload.body?.data) return decode(payload.body.data)
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mime)
    if (found.trim()) return found
  }
  return ''
}

export function extractBody(payload: any): string {
  if (!payload) return ''

  // 1) Prefer text/plain anywhere in the tree
  const plain = payload.mimeType === 'text/plain' && payload.body?.data
    ? decode(payload.body.data)
    : findPart(payload, 'text/plain')
  if (plain.trim()) return stripHtml(plain)

  // 2) Fall back to text/html (stripped of markup)
  const html = payload.mimeType === 'text/html' && payload.body?.data
    ? decode(payload.body.data)
    : findPart(payload, 'text/html')
  if (html.trim()) return stripHtml(html)

  // 3) Last resort: whatever direct body exists
  return stripHtml(decode(payload.body?.data))
}

// ── Header helpers ────────────────────────────────────────────────────────────

export function getHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

export interface ParsedSender {
  name:  string
  email: string
}

export function parseSender(fromHeader: string): ParsedSender {
  // Formats: "Name <email>" or just "email"
  const match = fromHeader.match(/^(.*?)\s*<(.+?)>$/)
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim().toLowerCase() }
  return { name: '', email: fromHeader.trim().toLowerCase() }
}

// ── Status keyword detection ──────────────────────────────────────────────────

export interface DetectedStatus {
  partsNeeded:   boolean   // parts identified as needed (may not yet be ordered)
  partsOrdered:  boolean   // parts have been explicitly ordered
  partsReceived: boolean   // parts in / arrived / received → ready to schedule
  isComplete:    boolean
  isScheduled:   boolean
  scheduledNote: string | null
  rawKeyword:    string | null
}

// Phrasings that mean parts have been ORDERED and we're now waiting for them.
// Shop convention: status updates start with "Update X ordered" where X can be
// "part", "parts", or any specific component name. Patterns here are deliberately
// broad — false-positive risk in a maintenance ticket is low.
const PARTS_ORDERED_PATTERNS: RegExp[] = [
  // Bare "ordered" anywhere — catches "Update part ordered", "Update sending unit
  // ordered", "Update new O2 sensors ordered", "Update passenger manifold ordered",
  // etc. Anchored to word boundaries to avoid matching inside other words.
  /\bordered\b/i,
  /\bre[\s-]?ordered\b/i,
  // Explicit phrasings (kept for clarity / future ref even though \bordered\b covers them)
  /parts?\s+on\s+order/i,
  /placed?\s+(?:an?\s+|the\s+)?order/i,
  /placing\s+(?:an?\s+|the\s+)?order/i,
  /back[\s-]?order(?:ed)?/i,
  /on\s+back\s*order/i,
  /parts?\s+shipped/i,
]

// Broader phrasings that mean parts are BLOCKING the work — covers pre-order
// ("need to order"), in-flight ("on the way"), and waiting variants. Anything
// here sends the ticket to the Waiting on Parts list.
const PARTS_NEEDED_PATTERNS: RegExp[] = [
  /parts?\s+needed/i,
  /need(?:s|ed|ing)?\s+(?:a\s+|the\s+|some\s+|new\s+|replacement\s+)?parts?/i,
  /need(?:s|ed|ing)?\s+to\s+(?:be\s+)?(?:order|get|grab|buy|pick\s*up)/i,
  /(?:have|has|got|gotta|going|gonna|will)\s+to\s+order/i,
  /ordering\s+(?:the\s+|a\s+|some\s+|new\s+|replacement\s+)?parts?/i,
  /waiting\s+(?:on|for)\s+(?:the\s+|a\s+|some\s+)?parts?/i,
  /awaiting\s+parts?/i,
  /parts?\s+(?:not|aren't|are\s+not|isn't|is\s+not)\s+(?:in|here|available)/i,
  /parts?\s+coming/i,
  /parts?\s+on\s+(?:the\s+)?way/i,
  /parts?\s+eta/i,
  /eta\s+(?:on|for|of)\s+(?:the\s+|a\s+)?parts?/i,
  /parts?\s+(?:will|should|expected\s+to)\s+(?:arrive|be\s+(?:in|here))/i,
  /missing\s+(?:a\s+|the\s+|some\s+)?parts?/i,
]

const PARTS_RECEIVED_PATTERNS: RegExp[] = [
  /parts?\s+received/i,
  /received\s+(?:the\s+|a\s+)?parts?/i,
  /parts?\s+are\s+(?:in|here)\b/i,
  /parts?\s+(?:in|here)\s+now/i,
  /parts?\s+arrived/i,
  /parts?\s+came\s+in/i,
  /parts?\s+delivered/i,
  /got\s+(?:the\s+|a\s+)?(?:new\s+|replacement\s+)?parts?/i,
  /picked\s+up\s+(?:the\s+|a\s+)?parts?/i,
  // Shop convention: "Update part @ shop", "Update parts at Shop", "Update part in Shop"
  // — all mean the part arrived and is sitting at the shop ready to install.
  /parts?\s*@\s*(?:the\s+)?shop/i,
  /parts?\s+at\s+(?:the\s+)?shop/i,
  /parts?\s+in\s+(?:the\s+)?shop/i,
  // Bare "@ shop" / "at the shop" preceded by "Update" — common terse form
  /\bupdate[\s:]*[^.\n]{0,40}@\s*(?:the\s+)?shop/i,
  /\bupdate[\s:]*[^.\n]{0,40}\bat\s+(?:the\s+)?shop\b/i,
  /\bupdate[\s:]*[^.\n]{0,40}\bin\s+(?:the\s+)?shop\b/i,
]

export function detectStatus(text: string): DetectedStatus {
  if (!text) {
    return {
      partsNeeded: false, partsOrdered: false, partsReceived: false,
      isComplete: false, isScheduled: false, scheduledNote: null, rawKeyword: null,
    }
  }

  const partsReceived = PARTS_RECEIVED_PATTERNS.some(r => r.test(text))

  // "Received" takes precedence — if parts are in, we're no longer waiting.
  const partsOrdered  = !partsReceived && PARTS_ORDERED_PATTERNS.some(r => r.test(text))

  // partsNeeded is a superset that catches everything parts-related that isn't
  // already received: "need to order", "waiting on parts", "ordering", "on backorder",
  // "parts coming", "ETA next week", etc. Any match here puts the ticket on the
  // Waiting on Parts list.
  const partsNeeded = !partsReceived &&
    (partsOrdered || PARTS_NEEDED_PATTERNS.some(r => r.test(text)))

  const isComplete =
    /\bcomplete\b|\bcompleted\b|job\s+complete|work\s+complete|repair\s+complete|\bdone\b|\bfinished\b|\binstalled\b|\breplaced\b/i.test(text)

  const scheduledMatch = text.match(
    /(?:alignment|inspection|repair|service|appointment)?\s*scheduled(?:\s+for)?\s+([^\n.]+)|needs?\s+scheduled/i
  )
  const isScheduled = /scheduled|needs?\s+(?:to\s+be\s+)?scheduled/i.test(text)

  // Pull the first matching keyword for logging
  const keywords = [
    isComplete    && 'complete',
    partsReceived && 'parts received/in',
    partsOrdered  && 'parts ordered',
    partsNeeded && !partsOrdered && 'parts needed',
    isScheduled   && 'scheduled',
  ].filter(Boolean)

  return {
    partsNeeded,
    partsOrdered,
    partsReceived,
    isComplete,
    isScheduled,
    scheduledNote: scheduledMatch ? scheduledMatch[0] : null,
    rawKeyword:    keywords[0] as string | null,
  }
}

// ── Personal vehicle detection ────────────────────────────────────────────────

/** Returns true if unit number looks like a personal vehicle (initials + PV, e.g. PWPV) */
export function isPersonalVehicle(unitNumber: string): boolean {
  return /^[A-Z]{2,4}PV$/i.test(unitNumber)
}

/** Extract the employee initials from a personal-vehicle unit number (PWPV → PW) */
export function personalVehicleInitials(unitNumber: string): string {
  return unitNumber.toUpperCase().replace(/PV$/i, '')
}

// ── Ticket number generation (date-based format MDDYY + unit) ─────────────────

export function generateTicketNumber(date: Date, unitNumber: string, existing: string[]): string {
  const m    = date.getMonth() + 1
  const d    = date.getDate()
  const y    = date.getFullYear().toString().slice(-2)
  const datePrefix = `${m}${d}${y}`
  // Units with spaces (e.g. facilities like "225 Garage") get a clean, readable
  // number: drop the spaces, uppercase, and separate from the date with a dash.
  const base = /\s/.test(unitNumber)
    ? `${datePrefix}-${unitNumber.replace(/\s+/g, '').toUpperCase()}`
    : `${datePrefix}${unitNumber}`

  if (!existing.includes(base)) return base

  for (let i = 0; i < 26; i++) {
    const candidate = base + String.fromCharCode(65 + i)
    if (!existing.includes(candidate)) return candidate
  }
  return `${base}Z`
}
