import "server-only";
import { sql } from "drizzle-orm";
import { erpRead } from "./read";

// ERP account information for CRM companies (brief: "Who owns what": read-only on the company page).
// Money: totals from the sales summary are ex GST in the ENTITY's currency; order and invoice amounts are in the
// ORDER's currency. Each amount is shown with its own currency, never converted.

export type Entity = "NZ" | "AUS";

export type ErpAccount = {
  erp_entity: Entity;
  erp_customer_id: string;
  erp_customer_name: string | null;
  erp_code: string | null;
  payment_terms: string | null;
  credit_limit: string | null;
  credit_hold: boolean | null;
  erp_active: boolean | null;
  order_count: number | null;
  last_sale_date: string | null;
  total_ex_gst: string | null;
  total_ex_gst_12m: string | null;
  overdue_amount: string;
  overdue_invoices: number;
};

/** One row per confirmed ERP link (a business trading in NZ and AUS has two). */
export async function getCompanyErpAccounts(companyId: string): Promise<ErpAccount[]> {
  return erpRead<ErpAccount>(sql`
    select erp_entity, erp_customer_id, erp_customer_name, erp_code, payment_terms, credit_limit, credit_hold, erp_active,
           order_count::int as order_count, last_sale_date, total_ex_gst, total_ex_gst_12m,
           overdue_amount, overdue_invoices::int as overdue_invoices
    from crm.v_company_erp
    where company_id = ${companyId}
    order by erp_entity desc`);
}

export type ErpDocument = {
  id: string;
  entity_id: Entity;
  number: string;
  status: string;
  quote_status: string | null;
  order_date: string;
  quote_expires_on: string | null;
  invoice_due_on: string | null;
  currency: string;
  total: string;
  xero_amount_due: string | null;
  is_overdue: boolean;
};

/** Open quotes (draft, sent) and open orders (open, picked, shipped), plus any overdue invoices. */
export async function listErpDocuments(customerIds: string[]): Promise<ErpDocument[]> {
  if (customerIds.length === 0) return [];
  return erpRead<ErpDocument>(sql`
    select o.id, o.entity_id, o.number, o.status::text as status, o.quote_status::text as quote_status, o.order_date,
           o.quote_expires_on, o.invoice_due_on, o.currency, o.total, o.xero_amount_due, o.is_overdue
    from erp_read.sales_orders o
    where o.customer_id in ${customerIds}
      and ((o.status = 'quote' and o.quote_status in ('draft', 'sent'))
           or o.status in ('open', 'picked', 'shipped')
           or o.is_overdue)
    order by o.is_overdue desc, o.order_date desc`);
}

export type ErpCustomerOption = {
  id: string;
  entity_id: Entity;
  name: string;
  code: string | null;
  email: string | null;
  billing_city: string | null;
  active: boolean;
  linked_company_id: string | null;
  linked_company: string | null;
};

/** ERP customers in one entity whose name, code or email contains the text, with any existing CRM link. */
export async function searchErpCustomers(entity: Entity, q: string, limit = 20): Promise<ErpCustomerOption[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return erpRead<ErpCustomerOption>(sql`
    select c.id, c.entity_id, c.name, c.code, c.email, c.billing_city, c.active,
           l.company_id as linked_company_id, co.name as linked_company
    from erp_read.customers c
    left join crm.company_erp_links l on l.erp_entity = c.entity_id and l.erp_customer_id = c.id
    left join crm.companies co on co.id = l.company_id
    where c.entity_id = ${entity} and (c.name ilike ${like} or c.code ilike ${like} or c.email ilike ${like})
    order by c.active desc, c.name
    limit ${limit}`);
}

/** One ERP customer, to check a link request (exists, right entity, not deleted). */
export async function getErpCustomer(entity: Entity, id: string): Promise<{ id: string; name: string } | null> {
  const [c] = await erpRead<{ id: string; name: string }>(
    sql`select id, name from erp_read.customers where entity_id = ${entity} and id = ${id}`,
  );
  return c ?? null;
}
