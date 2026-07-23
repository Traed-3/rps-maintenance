// rps-doc-ingest — classification + normalization helpers.
// Mirrors lib/construction.ts (CON_DOC_CATEGORIES / CON_DOC_TYPES / classifyDocument
// / extractSiteNumber) in plain JS so the importer and the app agree. Keep in sync.

export const CATEGORY_VALUES = [
  'permits','quotes','change_orders','invoices','receipts',
  'photos','daily_updates','closeout','health_safety','other',
]

// type -> category, with lowercase keyword fragments. Specific → generic.
const TYPES = [
  ['completion_letter',   'closeout',      ['completion letter','letter of completion','completion-letter','-completion']],
  ['lien_waiver',         'closeout',      ['lien waiver','lien-waiver','lien']],
  ['permit_application',  'permits',       ['permit app','permit application','permit-app']],
  ['temp_closure',        'permits',       ['temp closure','temporary closure','fact sheet']],
  ['business_license',    'permits',       ['business license','business-license','county business']],
  ['contractors_license', 'permits',       ['contractors license','va contractors','contractor','lience']],
  ['permit',              'permits',       ['permit']],
  ['testing_form',        'closeout',      ['testing form','test form','spill bucket','spill containment','overfill','sump','udc']],
  ['drop_tube',           'closeout',      ['drop tube','drop-tube']],
  ['fuel_vendor_cert',    'closeout',      ['fuel vendor','vendor certification','certification statement']],
  ['equipment_cert',      'closeout',      ['veeder','gilbarco','red jacket','xerxes','bravo','fe petro','passport','opw','cert']],
  ['project_notification','closeout',      ['project notification','notification']],
  ['source_list',         'closeout',      ['source list','source-list']],
  ['invoice_worksheet',   'invoices',      ['invoice work sheet','work sheet','worksheet']],
  ['invoice',             'invoices',      ['invoice','itemize','itemized']],
  ['packing_slip',        'receipts',      ['packing slip','packing-slip','packing']],
  ['receipt',             'receipts',      ['receipt','expense']],
  ['change_order',        'change_orders', ['change order','change-order','chg order']],
  ['plan_notes',          'quotes',        ['plan notes','plan-notes','breakdown']],
  ['quote',               'quotes',        ['quote','bid','proposal','estimate']],
  ['photo',               'photos',        ['.jpg','.jpeg','.png','.heic','.gif','img_','image','photo','pic']],
]

export function classifyDocument(filename, folderHint) {
  const hay = `${folderHint ?? ''} ${filename}`.toLowerCase()
  for (const [type, category, matches] of TYPES) {
    if (matches.some(m => hay.includes(m))) return { category, docType: type, confident: true }
  }
  return { category: 'other', docType: null, confident: false }
}

// First 3–5 digit run not adjacent to other digits: "40037_PD"→40037, "Sheetz 155"→155.
export function extractSiteNumber(name) {
  const m = String(name).match(/(?<!\d)(\d{3,5})(?!\d)/)
  return m ? m[1] : null
}

// Candidate store numbers for a file, in priority order: deepest ancestor
// folder first (the project folder is the strongest signal), then shallower
// folders, then the filename. The caller resolves which candidate to use,
// preferring ones that match a real job and skipping year-like numbers.
export function storeCandidates(dirSegments, filename) {
  const out = []
  const push = n => { if (n && !out.includes(n)) out.push(n) }
  for (let i = dirSegments.length - 1; i >= 0; i--) push(extractSiteNumber(dirSegments[i]))
  push(extractSiteNumber(filename))
  return out
}

const isYear = n => { const v = +n; return v >= 2000 && v <= 2099 }

// Pick the best store number from candidates. Prefer a candidate that matches a
// known job store; otherwise the first non-year candidate; otherwise the first.
export function resolveStore(candidates, knownStores) {
  const known = candidates.find(c => knownStores.has(c))
  if (known) return known
  const nonYear = candidates.find(c => !isYear(c))
  return nonYear ?? candidates[0] ?? null
}

// Files/dirs the importer skips outright.
const IGNORE_NAMES = new Set(['.ds_store', 'icon\r', 'icon', 'thumbs.db', 'desktop.ini', '.dropbox', '.dropbox.attr'])
export function isIgnored(name) {
  const n = name.toLowerCase()
  if (n.startsWith('.')) return true
  if (IGNORE_NAMES.has(n)) return true
  return false
}

const MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', heic: 'image/heic', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook',
}
export function mimeFor(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return MIME[ext] || 'application/octet-stream'
}
