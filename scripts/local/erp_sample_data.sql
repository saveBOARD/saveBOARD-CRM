-- LOCAL TESTING ONLY (scripts/local-db.mjs). Made-up ERP rows: no real customer data.
-- Dates are relative to current_date so the scenarios stay true whenever the tests run.
-- Deliberately includes cost values, internal notes and a deleted customer: tests prove none reach the CRM.
--
-- Scenarios:
--   Fulton Hogan trades in NZ and AUS (two ERP customers, one CRM company with two links)
--   SO-1001 NZ quote sent, expiring in 2 days           -> deal quote_sent, chase "quote_expiring"
--   SO-1002 NZ quote draft                              -> deal qualified
--   SO-1003 NZ open order, 12 x SBEXP1012002400         -> deal won; committed stock 12
--   SO-1004 NZ invoiced, 1,150.00 due 10 days ago       -> overdue invoice
--   SO-900  NZ Katana order in sales_orders AND sales_history -> counted once (1,000.00)
--   SO-2001 AUS quote declined                          -> deal lost
--   Stock SBEXP1012002400: 100 opening - 10 shipped = 90 on hand, 12 committed, 78 available

insert into public.entities (id, name, legal_name, currency, gst_rate, location_name, business_number_label) values
  ('NZ',  'New Zealand', 'Example saveBOARD NZ Ltd',  'NZD', 0.15, 'Auckland', 'GST number'),
  ('AUS', 'Australia',   'Example saveBOARD Pty Ltd', 'AUD', 0.10, 'Sydney',   'ABN');

insert into public.price_lists (id, entity_id, name, is_default, notes) values
  ('10000000-0000-0000-0000-000000000001', 'NZ',  'Trade NZ',  true, 'internal pricing note'),
  ('10000000-0000-0000-0000-000000000002', 'AUS', 'Trade AUS', true, null);

insert into public.customers
  (id, entity_id, code, name, email, payment_terms, price_tier, price_list_id, credit_limit, credit_hold, notes, active, deleted_at)
values
  ('20000000-0000-0000-0000-000000000001', 'NZ',  'FH-NZ',  'Fulton Hogan Ltd',      'orders@fultonhogan.example', '20th of month', 'A', '10000000-0000-0000-0000-000000000001', 50000, false, 'internal: good payer', true,  null),
  ('20000000-0000-0000-0000-000000000002', 'NZ',  'ACME',   'Acme Builders Limited', 'accounts@acmebuild.example', '7 days',        'B', '10000000-0000-0000-0000-000000000001', 10000, true,  null,                   true,  null),
  ('20000000-0000-0000-0000-000000000003', 'AUS', 'FH-AU',  'Fulton Hogan Pty Ltd',  'orders@fultonhogan.example', '30 days',       null,'10000000-0000-0000-0000-000000000002', 80000, false, null,                   true,  null),
  ('20000000-0000-0000-0000-000000000004', 'NZ',  'GONE',   'Deleted Customer Ltd',  'gone@deleted.example',       null,            null, null,                                  null,  false, null,                   true,  now() - interval '30 days'),
  ('20000000-0000-0000-0000-000000000005', 'NZ',  'OLDMER', 'Old Merchant Ltd',      'buyer@oldmerchant.example',  '20th of month', null, null,                                  null,  false, null,                   false, null);

insert into public.customer_sites (customer_id, name, line1, city, country, is_default) values
  ('20000000-0000-0000-0000-000000000001', 'Christchurch yard', '1 Example Road', 'Christchurch', 'New Zealand', true);

insert into public.products (id, entity_id, sku, name, category, uom, standard_cost, track_stock) values
  ('30000000-0000-0000-0000-000000000001', 'NZ',  'SBEXP1012002400', 'Exterior / 2400 / 10mm', 'Board', 'sheet', 42.5000, true),
  ('30000000-0000-0000-0000-000000000002', 'AUS', 'SBEXP1012002400', 'Exterior / 2400 / 10mm', 'Board', 'sheet', 39.0000, true);

insert into public.price_list_items (price_list_id, product_id, price) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 89.9500),
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 84.0000);

insert into public.sales_orders
  (id, entity_id, number, status, quote_status, customer_id, order_date, quote_expires_on, currency,
   subtotal, tax, total, invoiced_on, invoice_due_on, xero_amount_due, source, notes)
values
  ('40000000-0000-0000-0000-000000000001', 'NZ',  'SO-1001', 'quote',    'sent',     '20000000-0000-0000-0000-000000000001', current_date - 9,   current_date + 2, 'NZD', 5213.04, 781.96, 5995.00, null, null, null, 'app', 'margin is thin on this one'),
  ('40000000-0000-0000-0000-000000000002', 'NZ',  'SO-1002', 'quote',    'draft',    '20000000-0000-0000-0000-000000000002', current_date - 1,   current_date + 29,'NZD', 1000.00, 150.00, 1150.00, null, null, null, 'app', null),
  ('40000000-0000-0000-0000-000000000003', 'NZ',  'SO-1003', 'open',     'accepted', '20000000-0000-0000-0000-000000000001', current_date - 3,   null,             'NZD', 1079.40, 161.91, 1241.31, null, null, null, 'app', null),
  ('40000000-0000-0000-0000-000000000004', 'NZ',  'SO-1004', 'invoiced', null,       '20000000-0000-0000-0000-000000000002', current_date - 45,  null,             'NZD', 1000.00, 150.00, 1150.00, current_date - 40, current_date - 10, 1150.00, 'app', null),
  ('40000000-0000-0000-0000-000000000005', 'NZ',  'SO-900',  'closed',   null,       '20000000-0000-0000-0000-000000000001', current_date - 120, null,             'NZD', 1000.00, 150.00, 1150.00, null, null, null, 'katana', null),
  ('40000000-0000-0000-0000-000000000006', 'AUS', 'SO-2001', 'quote',    'declined', '20000000-0000-0000-0000-000000000003', current_date - 20,  current_date + 10,'AUD', 2000.00, 200.00, 2200.00, null, null, null, 'app', null);

insert into public.order_lines (order_id, line_no, product_id, sku, description, qty, unit_price, tax_rate, line_subtotal, line_tax) values
  ('40000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000001', 'SBEXP1012002400', 'Exterior / 2400 / 10mm', 58, 89.88, 0.15, 5213.04, 781.96),
  ('40000000-0000-0000-0000-000000000003', 1, '30000000-0000-0000-0000-000000000001', 'SBEXP1012002400', 'Exterior / 2400 / 10mm', 12, 89.95, 0.15, 1079.40, 161.91);

-- Katana order SO-900: also in sales_history (the ERP's report-only copy). Must be counted once.
insert into public.sales_history (entity_id, so_number, customer_name, customer_id, order_date, shipped_on, sku, description, qty, unit_price, tax_rate, subtotal, currency) values
  ('NZ', 'SO-900', 'Fulton Hogan Ltd', '20000000-0000-0000-0000-000000000001', current_date - 120, current_date - 100, 'SBEXP1012002400', 'Exterior / 2400 / 10mm', 6, 100, 0.15, 600, 'NZD'),
  ('NZ', 'SO-900', 'Fulton Hogan Ltd', '20000000-0000-0000-0000-000000000001', current_date - 120, current_date - 100, 'SBEXP1012002400', 'Exterior / 2400 / 10mm', 4, 100, 0.15, 400, 'NZD');

insert into public.stock_movements (entity_id, product_id, kind, qty, unit_cost, ref_number) values
  ('NZ', '30000000-0000-0000-0000-000000000001', 'opening',  100, 40.0000, 'OPEN'),
  ('NZ', '30000000-0000-0000-0000-000000000001', 'shipment', -10, 40.0000, 'SO-900');
