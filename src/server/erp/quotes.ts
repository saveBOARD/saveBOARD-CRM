import "server-only";
import { sql } from "drizzle-orm";
import { erpRead } from "./read";
import type { Entity } from "./company";

// ERP quotes and orders for deals (phase 5.1). Read-only from erp_read: number, status, dates, totals, and lines with
// prices ex GST. Never cost or margin (erpRead refuses any such column).

export type QuoteOption = {
  id: string;
  number: string;
  title: string | null;
  status: string;
  quote_status: string | null;
  order_date: string;
  quote_expires_on: string | null;
  currency: string;
  total: string;
  linked_deal_id: string | null;
  linked_deal_title: string | null;
};

/** The quotes and orders (last 12 months) of the ERP customers linked to a company, in one country. */
export async function listCompanyQuotes(companyId: string, entity: Entity): Promise<QuoteOption[]> {
  return erpRead<QuoteOption>(sql`
    select o.id, o.number, o.title, o.status::text as status, o.quote_status::text as quote_status, o.order_date,
           o.quote_expires_on, o.currency, o.total, d.id as linked_deal_id, d.title as linked_deal_title
    from erp_read.sales_orders o
    join crm.company_erp_links l on l.erp_customer_id = o.customer_id and l.erp_entity = o.entity_id and l.confirmed
    left join crm.deals d on d.entity = o.entity_id and d.erp_so_number = o.number and d.deleted_at is null
    where l.company_id = ${companyId} and o.entity_id = ${entity}
      and o.order_date > current_date - 365 and o.status <> 'cancelled'
    order by (o.status = 'quote' and o.quote_status in ('draft', 'sent')) desc, o.order_date desc
    limit 50`);
}

export type QuoteDetail = {
  id: string;
  number: string;
  title: string | null;
  status: string;
  quote_status: string | null;
  order_date: string;
  quote_expires_on: string | null;
  customer_reference: string | null;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  customer_name: string | null;
  credit_hold: boolean | null;
};

export type QuoteLine = {
  id: string;
  line_no: number;
  sku: string | null;
  product: string | null;
  description: string | null;
  qty: string;
  unit_price: string;
  discount_pct: string | null;
  line_subtotal: string;
};

/** One quote or order by its number in a country, with its lines. Null if the ERP has no such document. */
export async function getQuote(entity: Entity, number: string): Promise<{ quote: QuoteDetail; lines: QuoteLine[] } | null> {
  const [quote] = await erpRead<QuoteDetail>(sql`
    select o.id, o.number, o.title, o.status::text as status, o.quote_status::text as quote_status, o.order_date, o.quote_expires_on,
           o.customer_reference, o.currency, o.subtotal, o.tax, o.total, c.name as customer_name, c.credit_hold
    from erp_read.sales_orders o left join erp_read.customers c on c.id = o.customer_id
    where o.entity_id = ${entity} and o.number = ${number}`);
  if (!quote) return null;
  const lines = await erpRead<QuoteLine>(sql`
    select l.id, l.line_no, l.sku, p.name as product, l.description, l.qty, l.unit_price, l.discount_pct, l.line_subtotal
    from erp_read.order_lines l left join erp_read.products p on p.id = l.product_id
    where l.order_id = ${quote.id}
    order by l.line_no`);
  return { quote, lines };
}

/** Is this number a quote or order of a customer linked to the company (in that country)? */
export async function quoteBelongsToCompany(companyId: string, entity: Entity, number: string): Promise<boolean> {
  const [r] = await erpRead<{ ok: boolean }>(sql`
    select exists (
      select 1 from erp_read.sales_orders o
      join crm.company_erp_links l on l.erp_customer_id = o.customer_id and l.erp_entity = o.entity_id and l.confirmed
      where l.company_id = ${companyId} and o.entity_id = ${entity} and o.number = ${number}) as ok`);
  return r?.ok ?? false;
}

export type ErpCustomerDetail = {
  id: string;
  entity_id: Entity;
  code: string | null;
  name: string;
  billing_line1: string | null;
  billing_line2: string | null;
  billing_city: string | null;
  billing_region: string | null;
  billing_postcode: string | null;
  billing_country: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  credit_hold: boolean | null;
};

/** One ERP customer's trading details (no cost, no credit figures beyond the hold flag). */
export async function getErpCustomerDetail(entity: Entity, id: string): Promise<ErpCustomerDetail | null> {
  const [c] = await erpRead<ErpCustomerDetail>(sql`
    select id, entity_id, code, name, billing_line1, billing_line2, billing_city, billing_region, billing_postcode, billing_country,
           contact_name, phone, email, credit_hold
    from erp_read.customers where entity_id = ${entity} and id = ${id}`);
  return c ?? null;
}

/** A customer's quotes and orders in the last 12 months (for the link page). */
export async function listCustomerQuotes(entity: Entity, customerId: string): Promise<QuoteOption[]> {
  return erpRead<QuoteOption>(sql`
    select o.id, o.number, o.title, o.status::text as status, o.quote_status::text as quote_status, o.order_date,
           o.quote_expires_on, o.currency, o.total, null::uuid as linked_deal_id, null::text as linked_deal_title
    from erp_read.sales_orders o
    where o.entity_id = ${entity} and o.customer_id = ${customerId} and o.order_date > current_date - 365 and o.status <> 'cancelled'
    order by o.order_date desc limit 20`);
}
