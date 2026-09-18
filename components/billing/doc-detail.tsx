import Link from 'next/link'
import { FileDown, FileText, Receipt, Copy, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusButtons } from '@/components/construction/status-buttons'
import { DeleteButton } from '@/components/construction/delete-button'
import { DocFace } from '@/components/billing/doc-face'
import { EmailInvoiceForm, type SentEmail } from '@/components/construction/email-invoice-form'
import { QUOTE_STATUSES, INVOICE_STATUSES, fmtDate, money } from '@/lib/billing'
import { docFromRow } from '@/lib/billing-pdf'
import { setQuoteStatus, setInvoiceStatus, deleteQuote, deleteInvoice, convertQuoteToInvoice, duplicateQuote } from '@/app/(app)/billing/actions'

type Row = Record<string, unknown> & { con_customers: { id: string; name: string; billing_address: string | null; email: string | null; billing_contact: string | null } | null }

/** Detail page body for a quote or invoice: header facts, actions, the printed face, and the PDF links. */
export function DocDetail({ kind, row, lines, canWrite, emails, resendConfigured, invoicesFromQuote }: {
  kind: 'quote' | 'invoice'; row: Row; lines: Record<string, unknown>[]; canWrite: boolean; emails?: SentEmail[]; resendConfigured?: boolean; invoicesFromQuote?: { id: string; invoice_number: string | null; status: string }[]
}) {
  const id = row.id as string
  const isQ = kind === 'quote'
  const number = (isQ ? row.quote_number : row.invoice_number) as string | null
  const { doc, items } = docFromRow(kind, row, row.con_customers, lines)
  const pdfBase = `/api/billing/${isQ ? 'quotes' : 'invoices'}/${id}/pdf`
  const emailDefaults = !isQ ? {
    to: row.con_customers?.email ?? '',
    subject: `RPS Invoice ${number ?? ''}${row.store_label ? ` — ${row.store_label}` : ''}${row.po_number ? ` (PO ${row.po_number})` : ''}`,
    message: `${row.con_customers?.billing_contact ? `Hi ${row.con_customers.billing_contact},` : 'Hello,'}\n\nPlease find attached invoice ${number ?? ''}${row.project_description ? ` for ${row.project_description}` : ''}.${row.due_date ? ` Payment is due ${row.due_date}.` : ''}\n\nThank you,\nRappahannock Petroleum Services`,
  } : null

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <Link href={isQ ? '/billing/quotes' : '/billing/invoices'} className="text-sm text-gray-500 hover:text-gray-700">← {isQ ? 'Quotes' : 'Invoices'}</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 font-mono">{number ?? 'DRAFT'}<span className="ml-3 text-base font-sans font-normal text-gray-500 capitalize">{String(row.department ?? 'construction')}</span></h1>
            <p className="text-sm text-gray-600 mt-0.5">{row.con_customers?.name ?? 'No customer'}{row.store_label ? ` · ${row.store_label}` : ''}{row.site_number ? ` · ${row.site_number}` : ''}{row.csr_number ? ` · CSR ${row.csr_number}` : ''}</p>
            <p className="text-xs text-gray-400">{isQ ? `Quote date ${fmtDate(row.proposal_date as string)}${row.bid_due ? ` · bid due ${fmtDate(row.bid_due as string)}` : ''}` : `Invoice date ${fmtDate(row.invoice_date as string)}${row.due_date ? ` · due ${fmtDate(row.due_date as string)}` : ''}`} · labor {money(doc.inputs.labor_rate)}/hr{doc.laborRateLabel ? ` (${doc.laborRateLabel})` : ''} · markup {(doc.inputs.material_markup_pct * 100).toFixed(0)}%</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`${pdfBase}?view=face`} target="_blank" rel="noopener"><Button variant="outline" className="gap-2"><FileDown className="w-3.5 h-3.5" />{isQ ? 'Quote PDF' : 'Invoice PDF'}</Button></a>
            <a href={`${pdfBase}?view=breakdown`} target="_blank" rel="noopener"><Button variant="outline" className="gap-2"><FileText className="w-3.5 h-3.5" />Breakdown PDF</Button></a>
            {canWrite && <Link href={`/billing/${isQ ? 'quotes' : 'invoices'}/${id}/edit`}><Button className="gap-2"><Pencil className="w-3.5 h-3.5" />Edit</Button></Link>}
            {row.job_id ? <Link href={`/construction/jobs/${row.job_id}`}><Button variant="outline">Job</Button></Link> : null}
            {!isQ && row.quote_id ? <Link href={`/billing/quotes/${row.quote_id}`}><Button variant="outline">Quote</Button></Link> : null}
            {!isQ && row.service_ticket_id ? <Link href={`/service/tickets/${row.service_ticket_id}`}><Button variant="outline">Field ticket</Button></Link> : null}
          </div>
        </div>
        {canWrite && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StatusButtons id={id} current={String(row.status)} options={isQ ? QUOTE_STATUSES : INVOICE_STATUSES} action={isQ ? setQuoteStatus : setInvoiceStatus} />
            {isQ && (
              <div className="flex gap-2 ml-auto">
                <form action={duplicateQuote.bind(null, id)}><Button type="submit" variant="outline" className="gap-2"><Copy className="w-3.5 h-3.5" />Duplicate</Button></form>
                <form action={convertQuoteToInvoice.bind(null, id)}><Button type="submit" className="gap-2"><Receipt className="w-3.5 h-3.5" />Create invoice from this quote</Button></form>
              </div>
            )}
          </div>
        )}
        {isQ && invoicesFromQuote && invoicesFromQuote.length > 0 && <p className="mt-2 text-xs text-gray-500">Invoiced as {invoicesFromQuote.map(i => <Link key={i.id} href={`/billing/invoices/${i.id}`} className="text-blue-600 underline mr-2">{i.invoice_number ?? 'draft'}</Link>)}</p>}
      </div>

      {doc.scopeRows.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-4 overflow-hidden">
          <h3 className="px-4 py-2.5 bg-[#16243d] text-white text-sm font-semibold">SCOPE OF WORK · DESCRIPTION OF WORK</h3>
          <table className="w-full text-sm"><tbody className="divide-y divide-gray-50">{doc.scopeRows.map((r, i) => <tr key={i} className="align-top"><td className="px-4 py-2 font-medium text-gray-900 w-1/3">{r.scope}</td><td className="px-4 py-2 text-gray-700 whitespace-pre-line">{r.description}</td></tr>)}</tbody></table>
        </div>
      )}
      {!lines.length && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 mb-4">No lines yet. {canWrite ? 'Open Edit to add categories.' : ''}</div>}
      <DocFace kind={kind} items={items} inputs={doc.inputs} starting={doc.starting} />
      {(doc.exclusions || doc.warranty) && <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mt-4 text-sm text-gray-700 space-y-2">{doc.exclusions && <div><div className="text-xs font-medium text-gray-500 uppercase">Exclusions and clarifications</div><p className="whitespace-pre-line">{doc.exclusions}</p></div>}{doc.warranty && <p>{doc.warranty}</p>}</div>}
      {!isQ && canWrite && emailDefaults && <EmailInvoiceForm invoiceId={id} defaultTo={emailDefaults.to} defaultSubject={emailDefaults.subject} defaultMessage={emailDefaults.message} history={emails ?? []} configured={!!resendConfigured} />}
      {canWrite && <div className="mt-6 flex justify-end"><DeleteButton action={(isQ ? deleteQuote : deleteInvoice).bind(null, id)} confirm={`Delete this ${kind} and its lines?`} label={`Delete ${kind}`} /></div>}
    </div>
  )
}
