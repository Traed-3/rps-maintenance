/**
 * Parsing for the service-dispatch mailboxes (rpdispatcher / rpinvoicing).
 *
 * Three portals land in rpdispatcher, each with a distinct sender name and
 * a distinct structured body:
 *   - "7HELP Service Desk"  (7-Eleven)  — WOT######## / INC########
 *   - "WTSC"                (Wawa)      — FWKD########
 *   - "IT Service Desk"     (Sunoco)    — WOT######## (no incident number)
 *
 * rpinvoicing gets a *forward* of the original dispatch email from a field
 * tech's personal @rp.gmail address, with one line of their own text on top
 * ("COMPLETE", "INCOMPLETE RTN WITH MAG SENSOR", etc.) before the quoted
 * original message.
 */

import { stripHtml, getHeader, parseSender } from '@/lib/gmail-parser'

// ── Shared ────────────────────────────────────────────────────────────────────

const WO_NUMBER = /\b(WOT\d+|FWKD\d+)\b/

export function extractWorkOrderNumber(text: string): string | null {
  return text.match(WO_NUMBER)?.[1] ?? null
}

export function extractIncidentNumber(text: string): string | null {
  return text.match(/\bINC\d+\b/)?.[0] ?? null
}

function decode(b64?: string): string {
  if (!b64) return ''
  try { return Buffer.from(b64, 'base64url').toString('utf-8') } catch { return '' }
}

function findPart(payload: any, mime: string): string {
  if (!payload) return ''
  if (payload.mimeType === mime && payload.body?.data) return decode(payload.body.data)
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mime)
    if (found.trim()) return found
  }
  return ''
}

/** Same body-extraction logic as the fleet parser (text/plain preferred, HTML stripped as fallback). */
export function extractBody(payload: any): string {
  if (!payload) return ''
  const plain = payload.mimeType === 'text/plain' && payload.body?.data
    ? decode(payload.body.data) : findPart(payload, 'text/plain')
  if (plain.trim()) return stripHtml(plain)
  const html = payload.mimeType === 'text/html' && payload.body?.data
    ? decode(payload.body.data) : findPart(payload, 'text/html')
  if (html.trim()) return stripHtml(html)
  return stripHtml(decode(payload.body?.data))
}

export { getHeader, parseSender }

// ── Dispatch email parsing (rpdispatcher) ───────────────────────────────────

export type SourcePortal = '7help' | 'wtsc' | 'it_service_desk' | 'unknown'

export interface ParsedDispatch {
  sourcePortal:    SourcePortal
  clientName:      string | null
  woNumber:        string | null
  incidentNumber:  string | null
  siteNumber:      string | null
  siteName:        string | null
  siteAddress:     string | null
  siteCity:        string | null
  siteState:       string | null
  priorityRaw:     string | null
  priorityRank:    number | null   // 1 (most urgent) .. 5
  isInvoiceRejection: boolean
  invoiceRejectionReason: string | null
  isAssignmentOnly: boolean        // "has been assigned" / "mentioned" / "priority changed" — no new detail to extract
}

function detectPortal(senderName: string, subject: string): SourcePortal {
  const n = senderName.toLowerCase()
  if (n.includes('7help')) return '7help'
  if (n.includes('wtsc')) return 'wtsc'
  if (n.includes('it service desk')) return 'it_service_desk'
  // Fallback by subject shape
  if (/FWKD\d+/.test(subject)) return 'wtsc'
  if (/7-eleven/i.test(subject)) return '7help'
  if (/work order task/i.test(subject)) return 'it_service_desk'
  return 'unknown'
}

function normalizePriority(portal: SourcePortal, raw: string | null): number | null {
  if (!raw) return null
  const m = raw.match(/P(\d)/i) || raw.match(/Priority\s*:?\s*(\d)/i)
  if (m) return parseInt(m[1], 10)
  return null
}

export function parseDispatchEmail(subject: string, body: string, senderName: string): ParsedDispatch {
  const portal = detectPortal(senderName, subject)
  const woNumber = extractWorkOrderNumber(subject) ?? extractWorkOrderNumber(body)
  const incidentNumber = extractIncidentNumber(subject) ?? extractIncidentNumber(body)

  const isInvoiceRejection = /invoice.*(rejected|invoice rejected)/i.test(subject) || /invoice.*rejected/i.test(body)
  const invoiceRejectionReasonMatch = body.match(/Rejection Reason:\s*([^\n]+)/i) || body.match(/rejected by [^\n]+ with the following reason:\s*([^\n]+)/i)
  const invoiceRejectionReason = invoiceRejectionReasonMatch ? invoiceRejectionReasonMatch[1].trim() : null

  const isAssignmentOnly = /has been assigned$|mentioned in|priority has been changed/i.test(subject.trim())

  let siteNumber: string | null = null
  let siteName: string | null = null
  let siteAddress: string | null = null
  let siteCity: string | null = null
  let siteState: string | null = null
  let clientName: string | null = null
  let priorityRaw: string | null = null

  if (portal === '7help') {
    clientName = '7-Eleven'
    const pm = subject.match(/Priority\s+(P\d[^-]*-[^W]+)/i)
    priorityRaw = pm ? pm[1].trim() : (subject.match(/P\d/)?.[0] ?? null)

    // "Store Location: 7-ELEVEN STORE - 40400 Store Address: 7320 GAMBRILL RD,SPRINGFIELD,VA,US,22150"
    const locMatch = body.match(/Store Location:\s*([^\n]+?)\s*-\s*(\d+)\s*Store Address:\s*([^\n]+)/i)
    if (locMatch) {
      siteName = locMatch[1].trim()
      siteNumber = locMatch[2].trim()
      const addrParts = locMatch[3].split(',').map(s => s.trim())
      siteAddress = addrParts[0] ?? null
      siteCity    = addrParts[1] ?? null
      siteState   = addrParts[2] ?? null
    } else {
      // IT Service Desk-style "Location 80003586" fallback inside a 7help-detected email
      const locNum = subject.match(/Location\s+(\d+)/i)
      if (locNum) siteNumber = locNum[1]
    }
  } else if (portal === 'wtsc') {
    clientName = 'Wawa'
    const pm = body.match(/Priority\s*:\s*(\d)/i)
    priorityRaw = pm ? `Priority ${pm[1]}` : null
    const storeMatch = body.match(/Store\s*:\s*(\S+)/i)
    siteNumber = storeMatch ? storeMatch[1].trim() : null
    const tagMatch = body.match(/TAG\s*:\s*\d+\s+([^\n]+?)\s+Callers Name/i)
    siteName = tagMatch ? tagMatch[1].trim() : null
  } else if (portal === 'it_service_desk') {
    clientName = 'Sunoco'
    const pm = subject.match(/Priority\s+(\d[^,\n]*)/i)
    priorityRaw = pm ? pm[1].trim() : null
    const locNum = subject.match(/Location\s+(\d+)/i)
    siteNumber = locNum ? locNum[1] : null
    // Address is the first standalone address-shaped line in the body
    const addrMatch = body.match(/([0-9][^\n,]+),\s*([A-Z][A-Za-z .]+),\s*([A-Z]{2}),?\s*\d{5}/)
    if (addrMatch) {
      siteAddress = addrMatch[1].trim()
      siteCity    = addrMatch[2].trim()
      siteState   = addrMatch[3].trim()
    }
  }

  return {
    sourcePortal: portal,
    clientName,
    woNumber,
    incidentNumber,
    siteNumber,
    siteName,
    siteAddress,
    siteCity,
    siteState,
    priorityRaw,
    priorityRank: normalizePriority(portal, priorityRaw),
    isInvoiceRejection,
    invoiceRejectionReason,
    isAssignmentOnly,
  }
}

// ── Completion email parsing (rpinvoicing) ──────────────────────────────────

export type CompletionStatus = 'complete' | 'incomplete' | 'rtn' | 'unknown'

export interface ParsedCompletion {
  woNumber:   string | null
  status:     CompletionStatus
  note:       string
}

const FORWARD_MARKERS = [
  /-{5,}\s*Forwarded message\s*-{5,}/i,
  /Begin forwarded message:/i,
]

/** The tech's own line(s) sit above the quoted original — split there. */
function techNote(body: string): string {
  let cut = body.length
  for (const marker of FORWARD_MARKERS) {
    const m = body.match(marker)
    if (m && m.index !== undefined && m.index < cut) cut = m.index
  }
  return body.slice(0, cut).trim()
}

export function parseCompletionEmail(subject: string, body: string): ParsedCompletion {
  const woNumber = extractWorkOrderNumber(subject) ?? extractWorkOrderNumber(body)
  const note = techNote(body)
  const noteLower = note.toLowerCase()

  let status: CompletionStatus = 'unknown'
  if (/\brtn\b|retrip|return trip/i.test(noteLower)) {
    status = 'rtn'
  } else if (/incomplete/i.test(noteLower)) {
    status = 'incomplete'
  } else if (/\bcomplete\b|job complete/i.test(noteLower)) {
    status = 'complete'
  }

  return { woNumber, status, note: note.slice(0, 1000) }
}
