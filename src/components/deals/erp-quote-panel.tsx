import { unlinkQuoteAction } from "@/app/(app)/deal-actions";
import { Panel, Pill } from "@/components/ui/detail";
import { SimpleTable } from "@/components/ui/simple-table";
import { formatDate, formatMoney } from "@/lib/format";
import type { QuoteDetail, QuoteLine, QuoteOption } from "@/server/erp";
import { QuoteLinkButton, QuoteNumberForm } from "./quote-link-form";

const statusText = (status: string, quoteStatus: string | null) => (status === "quote" ? `Quote, ${quoteStatus ?? "draft"}` : `Order, ${status}`);

/**
 * The ERP quote on a deal (phase 5.1): the linked quote with its lines (prices ex GST; never cost), or the company's
 * quotes and orders to link one. Read-only: quotes are made and sent in the ERP.
 */
export function ErpQuotePanel({
  dealId,
  linked,
  options,
  canLink,
}: {
  dealId: string;
  linked: { quote: QuoteDetail; lines: QuoteLine[] } | null;
  options: QuoteOption[];
  canLink: string | null; // why linking isn't possible yet, or null
}) {
  if (linked) {
    const q = linked.quote;
    return (
      <Panel
        title={`ERP ${q.status === "quote" ? "quote" : "order"} ${q.number}`}
        actions={
          <form action={unlinkQuoteAction}>
            <input type="hidden" name="deal_id" value={dealId} />
            <button type="submit" className="text-xs text-muted underline hover:text-bad">
              Unlink
            </button>
          </form>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Pill tone={q.quote_status === "declined" || q.quote_status === "expired" || q.status === "cancelled" ? "bad" : "progress"}>{statusText(q.status, q.quote_status)}</Pill>
            <span>{q.customer_name}</span>
            {q.customer_reference && <span className="text-muted">Ref {q.customer_reference}</span>}
            <span className="text-muted">Dated {formatDate(q.order_date)}</span>
            {q.quote_expires_on && <span className="text-muted">Expires {formatDate(q.quote_expires_on)}</span>}
            {q.credit_hold && <Pill tone="warn">Customer on credit hold: quotes are fine, orders are blocked</Pill>}
          </div>
          <SimpleTable<QuoteLine>
            rows={linked.lines}
            empty="No lines on this quote yet."
            columns={[
              { header: "Product", cell: (l) => [l.sku, l.product ?? l.description].filter(Boolean).join(" · ") },
              { header: "Qty", numeric: true, cell: (l) => Number(l.qty).toLocaleString("en-NZ") },
              { header: "Unit price (ex GST)", numeric: true, cell: (l) => formatMoney(l.unit_price, q.currency) },
              { header: "Discount", numeric: true, cell: (l) => (l.discount_pct && Number(l.discount_pct) ? `${Math.round(Number(l.discount_pct) * 1000) / 10}%` : "") },
              { header: "Line (ex GST)", numeric: true, cell: (l) => formatMoney(l.line_subtotal, q.currency) },
            ]}
          />
          <div className="text-right text-sm">
            Subtotal {formatMoney(q.subtotal, q.currency)} · GST {formatMoney(q.tax, q.currency)} · <b>Total {formatMoney(q.total, q.currency)}</b>
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="ERP quote">
      {canLink ? (
        <p className="text-sm text-muted">{canLink}</p>
      ) : (
        <div className="grid gap-3">
          {options.length === 0 ? (
            <p className="text-sm text-muted">This customer has no quotes or orders in the ERP in the last 12 months.</p>
          ) : (
            <SimpleTable<QuoteOption>
              rows={options}
              empty=""
              columns={[
                { header: "Number", cell: (o) => <span className="font-mono text-xs">{o.number}</span> },
                { header: "Title", cell: (o) => o.title },
                { header: "Status", cell: (o) => statusText(o.status, o.quote_status) },
                { header: "Date", cell: (o) => formatDate(o.order_date) },
                { header: "Total", numeric: true, cell: (o) => formatMoney(o.total, o.currency) },
                { header: "", cell: (o) => (o.linked_deal_id ? <span className="text-xs text-muted">On {o.linked_deal_title}</span> : <QuoteLinkButton dealId={dealId} number={o.number} />) },
              ]}
            />
          )}
          <QuoteNumberForm dealId={dealId} />
        </div>
      )}
    </Panel>
  );
}
