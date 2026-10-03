-- =============================================================================
-- saveBOARD CRM  |  Migration 2 of 5  |  erp_read views (READ-ONLY window onto the ERP)
--
-- *** This touches the LIVE ERP database. Creates views only: no ERP table, column,
-- *** or row is changed. Any view or role change on the live database goes through Paul.
--
-- Safety design (from "saveBOARD ERP tables for CRM.md"):
--   * Views live in their own schema `erp_read`, which is NOT in Supabase's exposed schemas,
--     so the public Data API can never reach them. (A plain view runs with its owner's rights
--     and bypasses RLS, which is exactly why it must not sit in `public`.)
--   * Only the crm_app role can read them. It has NO privileges on the ERP's own tables.
--   * No cost or margin column is exposed anywhere. Excluded by design:
--       products.standard_cost, mo_materials.unit_cost, manufacturing_orders.*_cost,
--       stock_movements.unit_cost, goods_receipt_lines.unit_cost, customers.notes,
--       customers.price_tier (legacy), and the tables users, xero_connections, audit_log.
--   * Deleted customers (deleted_at is not null) are excluded.
-- Requires migration 1 (role crm_app). Re-runnable (create or replace).
-- =============================================================================

create schema if not exists erp_read;

revoke all on schema erp_read from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema erp_read from %I', r);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Entities
-- ---------------------------------------------------------------------------
create or replace view erp_read.entities as
select e.id, e.name, e.legal_name, e.currency, e.gst_rate
from public.entities e;

-- ---------------------------------------------------------------------------
-- Customers and delivery sites (trading accounts; deleted customers excluded)
-- ---------------------------------------------------------------------------
create or replace view erp_read.customers as
select c.id, c.entity_id, c.code, c.name,
       c.billing_line1, c.billing_line2, c.billing_city, c.billing_region,
       c.billing_postcode, c.billing_country,
       c.contact_name, c.phone, c.email, c.business_number, c.payment_terms,
       c.price_list_id, c.credit_limit, c.credit_hold,
       c.active, c.xero_contact_id, c.created_at, c.updated_at
from public.customers c
where c.deleted_at is null;

create or replace view erp_read.customer_sites as
select s.id, s.customer_id, s.name, s.line1, s.line2, s.city, s.region, s.postcode, s.country,
       s.contact_name, s.contact_phone, s.is_default
from public.customer_sites s
join public.customers c on c.id = s.customer_id
where c.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Quotes, sales orders and invoices (one table in the ERP: sales_orders)
--   quote            = status 'quote' (quote_status draft|sent|accepted|declined|expired)
--   has an invoice   = invoiced_on is not null (NOT inferred from status: orders can be invoiced early)
--   overdue          = xero_amount_due > 0 and invoice_due_on < current_date
--   sale_date        = invoiced_on, else latest non-reversed shipment date, else order_date
--   counts_as_sale   = status in (shipped, invoiced, closed)
-- Amounts are in the ORDER's currency; multiply by fx_rate for the entity currency.
-- ---------------------------------------------------------------------------
create or replace view erp_read.sales_orders as
select o.id, o.entity_id, o.number, o.title, o.status, o.quote_status,
       o.customer_id, o.customer_reference,
       o.order_date, o.delivery_deadline, o.quote_expires_on,
       o.currency, o.fx_rate, o.subtotal, o.tax, o.total,
       o.invoiced_on, o.invoice_due_on, o.xero_invoice_id, o.xero_status,
       o.xero_amount_due, o.xero_amount_paid, o.xero_synced_at,
       o.source, o.created_at, o.updated_at,
       (o.invoiced_on is not null) as has_invoice,
       (coalesce(o.xero_amount_due, 0) > 0 and o.invoice_due_on < current_date) as is_overdue,
       (o.status in ('shipped', 'invoiced', 'closed')) as counts_as_sale,
       coalesce(o.invoiced_on, ship.last_shipped_on, o.order_date) as sale_date
from public.sales_orders o
left join lateral (
  select max(sh.shipped_on) as last_shipped_on
  from public.shipments sh
  where sh.order_id = o.id and sh.reversed_at is null
) ship on true;

create or replace view erp_read.order_lines as
select l.id, l.order_id, l.line_no, l.product_id, l.sku, l.description,
       l.qty, l.unit_price, l.discount_pct, l.tax_rate, l.line_subtotal, l.line_tax
from public.order_lines l;

create or replace view erp_read.overdue_invoices as
select o.id as order_id, o.entity_id, o.number, o.customer_id, o.currency,
       o.invoice_due_on, o.xero_amount_due,
       (current_date - o.invoice_due_on) as days_overdue
from public.sales_orders o
where coalesce(o.xero_amount_due, 0) > 0 and o.invoice_due_on < current_date;

-- ---------------------------------------------------------------------------
-- Price lists and products (no cost columns)
-- ---------------------------------------------------------------------------
create or replace view erp_read.price_lists as
select p.id, p.entity_id, p.name, p.is_default, p.adjust_pct, p.active
from public.price_lists p;

create or replace view erp_read.price_list_items as
select i.price_list_id, i.product_id, i.price
from public.price_list_items i;

create or replace view erp_read.products as
select p.id, p.entity_id, p.sku, p.name, p.type, p.category, p.uom, p.track_stock, p.active
from public.products p;

-- ---------------------------------------------------------------------------
-- Stock availability, from the stock ledger (sum of movements) with no unit costs.
--   on_hand   = sum of stock_movements.qty
--   committed = open/picked sales orders: ordered qty minus qty already shipped (non-reversed)
--   expected  = open purchase orders: ordered qty minus qty already received (non-reversed)
--   available = on_hand - committed
-- NOTE: committed / expected / available are the CRM's own calculation. Compare them with the
-- ERP's Inventory screen on a few products before relying on them for quoting decisions.
-- ---------------------------------------------------------------------------
create or replace view erp_read.product_stock as
with on_hand as (
  select m.entity_id, m.product_id, sum(m.qty) as qty
  from public.stock_movements m
  group by m.entity_id, m.product_id
), shipped as (
  select sl.order_line_id, sum(sl.qty) as qty
  from public.shipment_lines sl
  join public.shipments sh on sh.id = sl.shipment_id and sh.reversed_at is null
  group by sl.order_line_id
), committed as (
  select o.entity_id, l.product_id,
         sum(greatest(l.qty - coalesce(s.qty, 0), 0)) as qty
  from public.order_lines l
  join public.sales_orders o on o.id = l.order_id and o.status in ('open', 'picked')
  left join shipped s on s.order_line_id = l.id
  where l.product_id is not null
  group by o.entity_id, l.product_id
), received as (
  select gl.po_line_id, sum(gl.qty) as qty
  from public.goods_receipt_lines gl
  join public.goods_receipts gr on gr.id = gl.receipt_id and gr.reversed_at is null
  group by gl.po_line_id
), expected as (
  select po.entity_id, pl.product_id,
         sum(greatest(pl.qty - coalesce(r.qty, 0), 0)) as qty
  from public.po_lines pl
  join public.purchase_orders po on po.id = pl.po_id and po.status = 'open'
  left join received r on r.po_line_id = pl.id
  where pl.product_id is not null
  group by po.entity_id, pl.product_id
)
select p.id as product_id, p.entity_id, p.sku, p.name,
       coalesce(h.qty, 0) as on_hand,
       coalesce(c.qty, 0) as committed,
       coalesce(x.qty, 0) as expected,
       coalesce(h.qty, 0) - coalesce(c.qty, 0) as available
from public.products p
left join on_hand h   on h.product_id = p.id and h.entity_id = p.entity_id
left join committed c on c.product_id = p.id and c.entity_id = p.entity_id
left join expected x  on x.product_id = p.id and x.entity_id = p.entity_id
where p.active and p.track_stock;

-- ---------------------------------------------------------------------------
-- Sales history (Katana completed orders, report-only copy)
-- ---------------------------------------------------------------------------
create or replace view erp_read.sales_history as
select h.id, h.entity_id, h.so_number, h.title, h.customer_name, h.customer_id,
       h.order_date, h.shipped_on, h.product_id, h.sku, h.description, h.category,
       h.qty, h.unit_price, h.discount_pct, h.tax_rate, h.subtotal, h.currency
from public.sales_history h;

-- ---------------------------------------------------------------------------
-- Customer sales summary: each completed order counted ONCE.
--   * Katana orders live in BOTH sales_history and sales_orders (as 'closed', source 'katana').
--     Skip the sales_orders row when sales_history has the same entity + so_number.
--   * History rows with no matched customer_id cannot be attributed and are left out.
--   * Amounts are ex-GST: history.subtotal as stored; app orders subtotal * fx_rate.
-- ---------------------------------------------------------------------------
create or replace view erp_read.customer_sales_summary as
with app_orders as (
  select o.customer_id, o.entity_id, o.number as so_number,
         o.sale_date, (o.subtotal * o.fx_rate) as amount
  from erp_read.sales_orders o
  where o.counts_as_sale
    and not exists (select 1 from public.sales_history h
                    where h.entity_id = o.entity_id and h.so_number = o.number)
), history_orders as (
  select h.customer_id, h.entity_id, h.so_number,
         max(coalesce(h.shipped_on, h.order_date)) as sale_date,
         sum(h.subtotal) as amount
  from public.sales_history h
  where h.customer_id is not null
  group by h.customer_id, h.entity_id, h.so_number
), all_orders as (
  select * from app_orders
  union all
  select * from history_orders
)
select a.customer_id, a.entity_id,
       count(*)                                                   as order_count,
       max(a.sale_date)                                           as last_sale_date,
       sum(a.amount)                                              as total_ex_gst,
       sum(a.amount) filter (where a.sale_date >= current_date - 365) as total_ex_gst_12m
from all_orders a
group by a.customer_id, a.entity_id;

-- ---------------------------------------------------------------------------
-- Grants: crm_app may only SELECT from this schema
-- ---------------------------------------------------------------------------
grant usage on schema erp_read to crm_app;
grant select on all tables in schema erp_read to crm_app;
alter default privileges in schema erp_read grant select on tables to crm_app;
revoke all on all tables in schema public from crm_app;   -- belt and braces
