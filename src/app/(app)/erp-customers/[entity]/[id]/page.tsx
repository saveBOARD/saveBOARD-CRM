import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createCompanyFromErpCustomer } from "@/app/(app)/erp-actions";
import { CustomerLinkForm } from "@/components/erp/customer-link-form";
import { PageHeader } from "@/components/shell/page-header";
import { Field, Panel, Pill } from "@/components/ui/detail";
import { SimpleTable } from "@/components/ui/simple-table";
import { formatDate, formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { requireAdmin } from "@/server/auth/session";
import { companyCandidates } from "@/server/crm/quote-links";
import { getErpCustomerDetail, listCustomerQuotes, type QuoteOption } from "@/server/erp";

export const metadata: Metadata = { title: "Link ERP customer" };

/**
 * An ERP customer with open quotes who isn't linked to a CRM company (phase 5.1, Paul 10 Oct 2026): link them to the
 * right company (likely matches first, e.g. "X-Frame Pty Ltd" = "XFrame"), or create the company from the ERP details.
 * Once linked, their quotes are suggested for deals. The ERP is never changed.
 */
export default async function LinkErpCustomerPage({ params }: PageProps<"/erp-customers/[entity]/[id]">) {
  await requireAdmin();
  const { entity, id } = await params;
  if ((entity !== "NZ" && entity !== "AUS") || !isUuid(id)) notFound();
  const customer = await getErpCustomerDetail(entity, id);
  if (!customer) notFound();
  const [candidates, quotes] = await Promise.all([companyCandidates(entity, id), listCustomerQuotes(entity, id)]);
  const address = [customer.billing_line1, customer.billing_line2, customer.billing_city, customer.billing_region, customer.billing_postcode]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <PageHeader title={`Link ERP customer: ${customer.name}`} />
      <Panel title={`In the ${entity} ERP`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">{customer.name}</Field>
          <Field label="Code">{customer.code}</Field>
          <Field label="Billing address">{address}</Field>
          <Field label="Contact">{[customer.contact_name, customer.email, customer.phone].filter(Boolean).join(" · ")}</Field>
          {customer.credit_hold && (
            <Field label="Credit">
              <Pill tone="warn">On credit hold</Pill>
            </Field>
          )}
        </div>
      </Panel>

      <Panel title="Which CRM company is this?">
        <div className="grid gap-5">
          <CustomerLinkForm entity={entity} erpCustomerId={id} candidates={candidates} />
          <form action={createCompanyFromErpCustomer} className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <input type="hidden" name="entity" value={entity} />
            <input type="hidden" name="erp_customer_id" value={id} />
            <span className="text-sm text-muted">Not in the CRM?</span>
            <button type="submit" className="btn-secondary">
              Create the company from these ERP details
            </button>
          </form>
        </div>
      </Panel>

      <Panel title="Their quotes and orders (last 12 months)">
        <SimpleTable<QuoteOption>
          rows={quotes}
          empty="None."
          columns={[
            { header: "Number", cell: (q) => <span className="font-mono text-xs">{q.number}</span> },
            { header: "Title", cell: (q) => q.title },
            { header: "Status", cell: (q) => (q.status === "quote" ? `Quote, ${q.quote_status ?? "draft"}` : `Order, ${q.status}`) },
            { header: "Date", cell: (q) => formatDate(q.order_date) },
            { header: "Total", numeric: true, cell: (q) => formatMoney(q.total, q.currency) },
          ]}
        />
      </Panel>
      <p className="text-sm text-muted">
        After linking, each open quote shows on <Link href="/" className="text-link hover:underline">Today</Link> to link to a deal or open one.
      </p>
    </div>
  );
}
