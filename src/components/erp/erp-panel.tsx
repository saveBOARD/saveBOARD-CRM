import { Field, Panel, Pill } from "@/components/ui/detail";
import { SimpleTable } from "@/components/ui/simple-table";
import { formatDate, formatMoney } from "@/lib/format";
import type { Tone } from "@/lib/labels";
import type { ErpAccount, ErpDocument } from "@/server/erp/company";
import { ErpLinkForm } from "./erp-link-form";
import { UnlinkButton } from "./unlink-button";

// Read-only ERP account panel on the company page (brief: ERP boundary, "Who owns what").
// No cost or margin ever appears here: the ERP read layer refuses those columns.

const ENTITY = { NZ: { name: "New Zealand", currency: "NZD" }, AUS: { name: "Australia", currency: "AUD" } } as const;

function docStatus(d: ErpDocument): { label: string; tone: Tone } {
  if (d.is_overdue) return { label: "Overdue", tone: "bad" };
  if (d.status === "quote") return { label: d.quote_status === "sent" ? "Quote sent" : "Quote draft", tone: "pending" };
  if (d.status === "picked") return { label: "Picked", tone: "progress" };
  if (d.status === "shipped") return { label: "Shipped", tone: "ok" };
  if (d.status === "invoiced") return { label: "Invoiced", tone: "ok" };
  return { label: "Open order", tone: "pending" };
}

export function ErpPanel({
  companyId,
  accounts,
  documents,
  isAdmin,
}: {
  companyId: string;
  accounts: ErpAccount[];
  documents: ErpDocument[];
  isAdmin: boolean;
}) {
  const unlinked = (["NZ", "AUS"] as const).filter((e) => !accounts.some((a) => a.erp_entity === e));

  return (
    <Panel title="ERP account" actions={isAdmin && unlinked.length > 0 ? <ErpLinkForm companyId={companyId} entities={[...unlinked]} /> : undefined}>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">
          Not linked to an ERP customer, so this is a prospect. {isAdmin ? "Link it once they are set up in the ERP." : "An admin can link it."}
        </p>
      ) : (
        <div className="grid gap-6">
          {accounts.map((a) => {
            const cur = ENTITY[a.erp_entity].currency;
            return (
              <div key={a.erp_entity} className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">
                    {a.erp_customer_name} {a.erp_code && <span className="font-mono text-xs text-muted">[{a.erp_code}]</span>}
                  </h3>
                  <span className="text-sm text-muted">{ENTITY[a.erp_entity].name}</span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {a.credit_hold && <Pill tone="bad">Credit hold: no new orders (quotes OK)</Pill>}
                    {a.erp_active === false && <Pill tone="faded">Inactive in ERP</Pill>}
                    {a.overdue_invoices > 0 && <Pill tone="bad">{a.overdue_invoices} overdue</Pill>}
                  </div>
                  {isAdmin && (
                    <UnlinkButton
                      companyId={companyId}
                      entity={a.erp_entity}
                      entityName={ENTITY[a.erp_entity].name}
                      customerName={a.erp_customer_name ?? "this customer"}
                    />
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Payment terms">{a.payment_terms}</Field>
                  <Field label="Credit limit">{formatMoney(a.credit_limit, cur)}</Field>
                  <Field label="Last order">{formatDate(a.last_sale_date)}</Field>
                  <Field label="Orders">{a.order_count ?? 0}</Field>
                  <Field label="Sales, last 12 months (ex GST)">{formatMoney(a.total_ex_gst_12m ?? 0, cur)}</Field>
                  <Field label="Sales, all time (ex GST)">{formatMoney(a.total_ex_gst ?? 0, cur)}</Field>
                  <Field label="Overdue">{Number(a.overdue_amount) > 0 ? formatMoney(a.overdue_amount, cur) : "None"}</Field>
                </div>
              </div>
            );
          })}

          <div>
            <h3 className="mb-2 text-sm font-medium">Open quotes and orders</h3>
            <SimpleTable<ErpDocument>
              rows={documents}
              empty="No open quotes, orders or overdue invoices."
              columns={[
                { header: "Number", cell: (d) => <span className="font-mono text-xs">{d.number}</span> },
                {
                  header: "Status",
                  cell: (d) => {
                    const s = docStatus(d);
                    return <Pill tone={s.tone}>{s.label}</Pill>;
                  },
                },
                { header: "Date", cell: (d) => formatDate(d.order_date) },
                {
                  header: "Expires / due",
                  cell: (d) => formatDate(d.status === "quote" ? d.quote_expires_on : d.invoice_due_on),
                },
                { header: "Total (incl GST)", numeric: true, cell: (d) => formatMoney(d.total, d.currency) },
                { header: "Owing", numeric: true, cell: (d) => (d.xero_amount_due && Number(d.xero_amount_due) > 0 ? formatMoney(d.xero_amount_due, d.currency) : "") },
              ]}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}
