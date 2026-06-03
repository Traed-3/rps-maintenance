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

// ── Body extraction ───────────────────────────────────────────────────────────

export function extractBody(payload: any): string {
  if (!payload) return ''

  // Direct body data
  if (payload.body?.data) {
    try {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
    } catch {
      return ''
    }
  }

  // Multipart — prefer text/plain
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        try {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8')
        } catch {}
      }
    }
    // Recurse into nested parts
    for (const part of payload.parts) {
      const body = extractBody(part)
      if (body.trim()) return body
    }
  }

  return ''
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
  partsOrdered:  boolean
  partsReceived: boolean   // parts in / arrived / received → ready to schedule
  isComplete:    boolean
  isScheduled:   boolean
  scheduledNote: string | null
  rawKeyword:    string | null
}

export function detectStatus(text: string): DetectedStatus {
  const t = text.toLowerCase()

  const partsOrdered =
    /parts?\s+ordered|ordered\s+the\s+parts?|parts?\s+on\s+order/i.test(text)

  const partsReceived =
    /parts?\s+(?:received|in|arrived)|parts?\s+are\s+in|received\s+parts?|parts?\s+came\s+in/i.test(text)

  const isComplete =
    /\bcomplete\b|\bcompleted\b|job\s+complete|work\s+complete|repair\s+complete|done\b/i.test(text)

  const scheduledMatch = text.match(
    /(?:alignment|inspection|repair|service|appointment)?\s*scheduled(?:\s+for)?\s+([^\n.]+)|needs?\s+scheduled/i
  )
  const isScheduled = /scheduled|needs?\s+(?:to\s+be\s+)?scheduled/i.test(text)

  // Pull the first matching keyword for logging
  const keywords = [
    isComplete    && 'complete',
    partsReceived && 'parts received/in',
    partsOrdered  && 'parts ordered',
    isScheduled   && 'scheduled',
  ].filter(Boolean)

  return {
    partsOrdered,
    partsReceived,
    isComplete,
    isScheduled,
    scheduledNote: scheduledMatch ? scheduledMatch[0] : null,
    rawKeyword:    keywords[0] as string | null,
  }
}

// ── Personal vehicle detection ────────────────────────────────────────────────

/** Returns true if unit number looks like a personal vehicle (PVXX) */
export function isPersonalVehicle(unitNumber: string): boolean {
  return /^PV[A-Z]{2,4}$/i.test(unitNumber)
}

// ── Ticket number generation (date-based format MDDYY + unit) ─────────────────

export function generateTicketNumber(date: Date, unitNumber: string, existing: string[]): string {
  const m    = date.getMonth() + 1
  const d    = date.getDate()
  const y    = date.getFullYear().toString().slice(-2)
  const base = `${m}${d}${y}${unitNumber}`

  if (!existing.includes(base)) return base

  for (let i = 0; i < 26; i++) {
    const candidate = base + String.fromCharCode(65 + i)
    if (!existing.includes(candidate)) return candidate
  }
  return `${base}Z`
}
