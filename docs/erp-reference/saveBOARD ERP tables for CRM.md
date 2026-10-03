# saveBOARD ERP — tables for the CRM views

Companion to `saveBOARD ERP schema (public).sql` (full structure) and the overview page
(https://claude.ai/artifact/PajkmQrsqUGB1LWHsidWKn). Postgres on Supabase, schema `public`. Updated 2 Oct 2026.

## Your names → ERP tables

| You asked for | ERP table(s) | Notes |
|---|---|---|
| Customers | `customers` | One row per customer **per entity** (`entity_id` = `'NZ'` or `'AUS'`). Name unique within an entity. |
| Delivery sites | `customer_sites` | `customer_id` → `customers.id`. Many per customer, one `is_default`. |
| Sales orders (and quotes) | `sales_orders` | A quote **is** a sales order with `status = 'quote'` (see `quote_status`). The number (`SO-1594`) never changes when it becomes an order. |
| Sales order lines | `order_lines` | `order_id` → `sales_orders.id`. `product_id` can be null (free-text lines); `sku` and `description` are always copied onto the line. |
| Invoices | *(no separate table)* `sales_orders` invoice columns | One order = one invoice, numbered with the order number. See "Invoices" below. |
| Credit notes | `sales_returns` + `return_lines` | Return number `RET-n` = credit note number in Xero. |
| Price lists | `price_lists` + `price_list_items` | Items keyed by (`price_list_id`, `product_id`). |
| Products | `products` | `sku` unique per entity. `type` = product / material / service. |
| Deliveries | `shipments` + `shipment_lines` | Ignore rows with `reversed_at` set. |
| Katana sales history | `sales_history` | Report-only copy of Katana's completed order lines (see "Sales history"). |
| Companies | `entities` | `id` = `'NZ'` / `'AUS'`, `currency`, `gst_rate`. |

## Keys and joins

- Every business table carries `entity_id` (directly or through its parent). **Always filter or group by entity.**
  NZ and AUS never share customers, products or numbers; a business trading with both companies is two customers.
- Match CRM accounts to `customers.id` **plus** `entity_id`. Don't match on name (it can change; Xero matching
  uses the exact name, so renames matter there).
- `customers.xero_contact_id` is filled once the customer has been invoiced through the live Xero link.
- `customers.price_list_id` null = the entity's default list (`price_lists.is_default`).
- `customers.price_tier` is a legacy text column from the old workbooks. Ignore it; use `price_list_id`.

## Customer status

| Columns | Meaning |
|---|---|
| `active = true`, `deleted_at is null` | Normal customer. |
| `active = false`, `deleted_at is null` | Inactive: hidden from order screens (most past Katana-only customers are here). |
| `deleted_at is not null` | Deleted: no longer a customer; kept only so past orders keep a name. Exclude from CRM lists. |
| `credit_hold = true` | No new sales orders (quotes still allowed). |

## Sales order / quote status

- `status` (enum `order_status`): `quote` → `open` → `picked` → `shipped` → `invoiced` → `closed`, or `cancelled`.
- `quote_status` (enum, only meaningful when `status = 'quote'`, set to `accepted` once converted):
  `draft`, `sent`, `accepted`, `declined`, `expired`.
- Open pipeline for a CRM: quotes with `quote_status in ('draft','sent')`; orders in `open`, `picked`, `shipped`.
- `source` = `'app'` (created in the ERP) or `'katana'` (imported from Katana, including ~1,900 completed orders
  loaded as `closed`).

## Money

- `subtotal`, `tax`, `total` (and line `line_subtotal`, `line_tax`) are in the **order's** currency (`currency`).
  Multiply by `fx_rate` for the entity's currency (almost always 1; occasionally a USD export order).
- `unit_price` is ex GST; `discount_pct` is a fraction (0.15 = 15%); `tax_rate` is a fraction (0.15 = 15%).
- Export orders: goods lines carry `tax_rate = 0`, freight keeps GST.

## Invoices (columns on `sales_orders`)

| Column | Meaning |
|---|---|
| `invoiced_on`, `invoice_due_on` | Set when invoiced. **`invoiced_on is not null` = has an invoice.** |
| `xero_invoice_id` | Set when the invoice was created through the live Xero link (null for older import-file invoices). |
| `xero_status` | As last read back from Xero: `DRAFT`, `SUBMITTED`, `AUTHORISED` (awaiting payment), `PAID`, `VOIDED`, `DELETED`. |
| `xero_amount_due`, `xero_amount_paid` | Incl. GST, order currency, refreshed every morning. |

- An order can be invoiced **before** it ships (cash / COD / custom work): then `invoiced_on` is set while `status`
  is still `open` or `picked`. Don't infer "invoiced" from `status` alone.
- Overdue = `xero_amount_due > 0 and invoice_due_on < current_date`.

## Sales history

Completed sales are in two places; count each order once:
- `sales_history`: Katana's completed order lines (NZ from Nov 2021, AUS from Feb 2023), keyed by `so_number`
  (+ `entity_id`), `customer_id` matched where possible (`customer_name` always kept).
- `sales_orders` with `status in ('shipped','invoiced','closed')` and their `order_lines`.
- The same Katana orders also exist in `sales_orders` (as `closed`, `source = 'katana'`), so **skip a
  `sales_orders` row when `sales_history` has the same `entity_id` + `so_number`** — that is exactly what the ERP's
  own sales reports do. Sale date: `sales_history.shipped_on` (else `order_date`); for app orders `invoiced_on`,
  else the latest non-reversed `shipments.shipped_on`, else `order_date`.

## Please keep out of the CRM

- `users` (contains password hashes), `xero_connections` (Xero access tokens), `audit_log`.
- Cost and margin: `products.standard_cost`, `mo_materials.unit_cost`, `manufacturing_orders.*_cost`,
  `stock_movements.unit_cost`. Business rule: costs never appear in anything customer-facing.

## Building the views safely

Supabase publishes the `public` schema through its Data API. RLS is on for every table, but **a plain view runs
with its owner's rights and bypasses RLS**, so a view in `public` could expose data to the internet. Please:
- create the CRM views in their own schema (e.g. `crm`) that is not in Supabase's exposed schemas, or
  `create view ... with (security_invoker = true)` and `revoke all ... from anon, authenticated`;
- give the CRM its own read-only database role limited to those views (never the app's owner credentials);
- or, preferred long term, read through a small read-only ERP API instead of the database (see the overview page).

Any view or role change on the live database goes through Paul.
