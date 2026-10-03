-- saveBOARD ERP — database schema (Postgres on Supabase, schema "public"), structure only, no data.
-- Generated 2 Oct 2026 from the app's schema definition (saveboard-erp/src/db/schema.ts via `drizzle-kit export`),
-- which is what the live database is migrated from (saveboard-erp/drizzle/0000–0016).
--
-- Not shown by the export, but present in the live database (added by the migrations):
--   * ROW LEVEL SECURITY is ENABLED on every table, with no policies. This closes Supabase's public Data API
--     (anon / authenticated roles get nothing); the app connects as the owner role.
--   * CREATE UNIQUE INDEX "price_lists_one_default" ON "price_lists" ("entity_id") WHERE "is_default";
--     (one default price list per entity)
--
-- See "saveBOARD ERP tables for CRM.md" (same folder) for what the tables mean and how they join.

CREATE TYPE "public"."mo_status" AS ENUM('not_started', 'in_progress', 'done', 'cancelled');
CREATE TYPE "public"."movement_kind" AS ENUM('opening', 'receipt', 'production_output', 'production_consume', 'shipment', 'adjustment', 'return');
CREATE TYPE "public"."order_status" AS ENUM('quote', 'open', 'picked', 'shipped', 'invoiced', 'closed', 'cancelled');
CREATE TYPE "public"."po_status" AS ENUM('draft', 'open', 'received', 'cancelled');
CREATE TYPE "public"."product_type" AS ENUM('product', 'material', 'service');
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'expired');
CREATE TYPE "public"."return_status" AS ENUM('open', 'received', 'cancelled');
CREATE TYPE "public"."stocktake_status" AS ENUM('counting', 'completed', 'cancelled');
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text,
	"user_id" uuid,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "customer_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"line1" text,
	"line2" text,
	"city" text,
	"region" text,
	"postcode" text,
	"country" text,
	"contact_name" text,
	"contact_phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"billing_line1" text,
	"billing_line2" text,
	"billing_city" text,
	"billing_region" text,
	"billing_postcode" text,
	"billing_country" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"business_number" text,
	"payment_terms" text,
	"price_tier" text,
	"price_list_id" uuid,
	"credit_limit" numeric(16, 4),
	"credit_hold" boolean DEFAULT false NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"xero_contact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text NOT NULL,
	"currency" text NOT NULL,
	"gst_rate" numeric(5, 4) NOT NULL,
	"location_name" text NOT NULL,
	"business_number_label" text NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"website" text,
	"tax_number" text,
	"quote_terms" text
);

CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"po_line_id" uuid NOT NULL,
	"product_id" uuid,
	"qty" numeric(16, 4) NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	"batch_no" text
);

CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"po_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"received_on" date NOT NULL,
	"supplier_ref" text,
	"notes" text,
	"created_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "manufacturing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"product_id" uuid NOT NULL,
	"planned_qty" numeric(16, 4) NOT NULL,
	"actual_qty" numeric(16, 4),
	"status" "mo_status" DEFAULT 'not_started' NOT NULL,
	"production_deadline" date,
	"delivery_deadline" date,
	"sales_order_id" uuid,
	"batch_no" text,
	"notes" text,
	"materials_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"operations_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mo_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mo_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"planned_qty" numeric(16, 4) NOT NULL,
	"actual_qty" numeric(16, 4),
	"unit_cost" numeric(16, 4),
	"batch_no" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "mo_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mo_id" uuid NOT NULL,
	"name" text NOT NULL,
	"planned_hours" numeric(16, 4) NOT NULL,
	"actual_hours" numeric(16, 4),
	"cost_per_hour" numeric(16, 4) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "number_sequences" (
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"prefix" text NOT NULL,
	"next_value" integer NOT NULL,
	CONSTRAINT "number_sequences_entity_id_kind_pk" PRIMARY KEY("entity_id","kind")
);

CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"sku" text,
	"description" text NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"discount_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 4) NOT NULL,
	"line_subtotal" numeric(16, 4) NOT NULL,
	"line_tax" numeric(16, 4) NOT NULL,
	"batch_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "po_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"sku" text,
	"description" text NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"tax_rate" numeric(5, 4) NOT NULL,
	"line_subtotal" numeric(16, 4) NOT NULL,
	"line_tax" numeric(16, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "price_list_items" (
	"price_list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price" numeric(16, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_items_price_list_id_product_id_pk" PRIMARY KEY("price_list_id","product_id")
);

CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"adjust_pct" numeric(7, 4),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"type" "product_type" DEFAULT 'product' NOT NULL,
	"category" text,
	"uom" text,
	"standard_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"cost_set_manually" boolean DEFAULT false NOT NULL,
	"default_supplier_id" uuid,
	"track_stock" boolean DEFAULT true NOT NULL,
	"safety_stock" numeric(16, 4) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"title" text,
	"supplier_id" uuid NOT NULL,
	"status" "po_status" DEFAULT 'draft' NOT NULL,
	"billed" boolean DEFAULT false NOT NULL,
	"order_date" date NOT NULL,
	"expected_on" date,
	"currency" text NOT NULL,
	"fx_rate" numeric(14, 6) DEFAULT '1' NOT NULL,
	"notes" text,
	"subtotal" numeric(16, 4) DEFAULT '0' NOT NULL,
	"tax" numeric(16, 4) DEFAULT '0' NOT NULL,
	"total" numeric(16, 4) DEFAULT '0' NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty_per_unit" numeric(16, 4) NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "recipe_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hours_per_unit" numeric(16, 4) NOT NULL,
	"cost_per_hour" numeric(16, 4) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"sku" text,
	"description" text NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"tax_rate" numeric(5, 4) NOT NULL,
	"line_subtotal" numeric(16, 4) NOT NULL,
	"line_tax" numeric(16, 4) NOT NULL,
	"restock" boolean DEFAULT true NOT NULL,
	"reason" text,
	"batch_no" text
);

CREATE TABLE "sales_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"so_number" text NOT NULL,
	"title" text,
	"customer_name" text NOT NULL,
	"customer_id" uuid,
	"order_date" date NOT NULL,
	"shipped_on" date,
	"product_id" uuid,
	"sku" text,
	"description" text NOT NULL,
	"category" text,
	"qty" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"discount_pct" numeric(7, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"subtotal" numeric(16, 4) NOT NULL,
	"currency" text NOT NULL,
	"customer_ref" text
);

CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"title" text,
	"status" "order_status" NOT NULL,
	"quote_status" "quote_status",
	"customer_id" uuid NOT NULL,
	"customer_reference" text,
	"order_date" date NOT NULL,
	"delivery_deadline" date,
	"quote_expires_on" date,
	"ship_to_name" text,
	"ship_to_phone" text,
	"ship_to_line1" text,
	"ship_to_line2" text,
	"ship_to_city" text,
	"ship_to_region" text,
	"ship_to_postcode" text,
	"ship_to_country" text,
	"notes" text,
	"price_list_id" uuid,
	"currency" text NOT NULL,
	"fx_rate" numeric(14, 6) DEFAULT '1' NOT NULL,
	"subtotal" numeric(16, 4) DEFAULT '0' NOT NULL,
	"tax" numeric(16, 4) DEFAULT '0' NOT NULL,
	"total" numeric(16, 4) DEFAULT '0' NOT NULL,
	"invoiced_on" date,
	"invoice_due_on" date,
	"xero_invoice_id" text,
	"xero_status" text,
	"xero_amount_due" numeric(16, 4),
	"xero_amount_paid" numeric(16, 4),
	"xero_synced_at" timestamp with time zone,
	"source" text DEFAULT 'app' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "return_status" DEFAULT 'open' NOT NULL,
	"return_date" date NOT NULL,
	"received_on" date,
	"notes" text,
	"currency" text NOT NULL,
	"subtotal" numeric(16, 4) DEFAULT '0' NOT NULL,
	"tax" numeric(16, 4) DEFAULT '0' NOT NULL,
	"total" numeric(16, 4) DEFAULT '0' NOT NULL,
	"credited_on" date,
	"xero_credit_note_id" text,
	"xero_status" text,
	"xero_synced_at" timestamp with time zone,
	"created_by" uuid,
	"received_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid,
	"qty" numeric(16, 4) NOT NULL,
	"batch_no" text
);

CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"shipped_on" date NOT NULL,
	"carrier" text,
	"consignment_no" text,
	"notes" text,
	"created_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stock_adjustment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	"batch_no" text,
	"note" text
);

CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"adjusted_on" date NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"stocktake_id" uuid,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_cost" numeric(16, 4),
	"batch_no" text,
	"ref_type" text,
	"ref_id" uuid,
	"ref_number" text,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stocktake_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"expected_qty" numeric(16, 4) NOT NULL,
	"counted_qty" numeric(16, 4),
	"note" text,
	"counted_by" uuid,
	"counted_at" timestamp with time zone
);

CREATE TABLE "stocktakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"reason" text NOT NULL,
	"scope" text NOT NULL,
	"status" "stocktake_status" DEFAULT 'counting' NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"adjustment_id" uuid,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"lead_time_days" integer,
	"payment_terms" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "user_entities" (
	"user_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	CONSTRAINT "user_entities_user_id_entity_id_pk" PRIMARY KEY("user_id","entity_id")
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);

CREATE TABLE "xero_connections" (
	"entity_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"connection_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "xero_sync_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"record_id" text,
	"doc_number" text,
	"ok" boolean NOT NULL,
	"message" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_sites" ADD CONSTRAINT "customer_sites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "customers" ADD CONSTRAINT "customers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customers" ADD CONSTRAINT "customers_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customers" ADD CONSTRAINT "customers_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mo_materials" ADD CONSTRAINT "mo_materials_mo_id_manufacturing_orders_id_fk" FOREIGN KEY ("mo_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "mo_materials" ADD CONSTRAINT "mo_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mo_operations" ADD CONSTRAINT "mo_operations_mo_id_manufacturing_orders_id_fk" FOREIGN KEY ("mo_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "products" ADD CONSTRAINT "products_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "products" ADD CONSTRAINT "products_default_supplier_id_suppliers_id_fk" FOREIGN KEY ("default_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_products_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "recipe_operations" ADD CONSTRAINT "recipe_operations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_entities" ADD CONSTRAINT "user_entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_entities" ADD CONSTRAINT "user_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "xero_connections" ADD CONSTRAINT "xero_connections_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "xero_connections" ADD CONSTRAINT "xero_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "xero_sync_log" ADD CONSTRAINT "xero_sync_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "xero_sync_log" ADD CONSTRAINT "xero_sync_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "audit_log_record" ON "audit_log" USING btree ("table_name","record_id");
CREATE UNIQUE INDEX "customers_entity_name" ON "customers" USING btree ("entity_id","name");
CREATE INDEX "goods_receipt_lines_receipt" ON "goods_receipt_lines" USING btree ("receipt_id");
CREATE INDEX "goods_receipt_lines_po_line" ON "goods_receipt_lines" USING btree ("po_line_id");
CREATE UNIQUE INDEX "goods_receipts_po_seq" ON "goods_receipts" USING btree ("po_id","seq");
CREATE UNIQUE INDEX "mo_entity_number" ON "manufacturing_orders" USING btree ("entity_id","number");
CREATE INDEX "mo_entity_status" ON "manufacturing_orders" USING btree ("entity_id","status");
CREATE INDEX "mo_materials_mo" ON "mo_materials" USING btree ("mo_id");
CREATE INDEX "mo_operations_mo" ON "mo_operations" USING btree ("mo_id");
CREATE INDEX "order_lines_order" ON "order_lines" USING btree ("order_id");
CREATE INDEX "order_lines_product" ON "order_lines" USING btree ("product_id");
CREATE INDEX "po_lines_po" ON "po_lines" USING btree ("po_id");
CREATE INDEX "po_lines_product" ON "po_lines" USING btree ("product_id");
CREATE INDEX "price_list_items_product" ON "price_list_items" USING btree ("product_id");
CREATE UNIQUE INDEX "price_lists_entity_name" ON "price_lists" USING btree ("entity_id","name");
CREATE UNIQUE INDEX "products_entity_sku" ON "products" USING btree ("entity_id","sku");
CREATE UNIQUE INDEX "purchase_orders_entity_number" ON "purchase_orders" USING btree ("entity_id","number");
CREATE INDEX "purchase_orders_supplier" ON "purchase_orders" USING btree ("supplier_id");
CREATE INDEX "recipe_lines_product" ON "recipe_lines" USING btree ("product_id");
CREATE INDEX "recipe_operations_product" ON "recipe_operations" USING btree ("product_id");
CREATE INDEX "return_lines_return" ON "return_lines" USING btree ("return_id");
CREATE INDEX "return_lines_order_line" ON "return_lines" USING btree ("order_line_id");
CREATE INDEX "sales_history_entity_date" ON "sales_history" USING btree ("entity_id","shipped_on");
CREATE INDEX "sales_history_entity_so" ON "sales_history" USING btree ("entity_id","so_number");
CREATE UNIQUE INDEX "sales_orders_entity_number" ON "sales_orders" USING btree ("entity_id","number");
CREATE INDEX "sales_orders_entity_status" ON "sales_orders" USING btree ("entity_id","status");
CREATE INDEX "sales_orders_customer" ON "sales_orders" USING btree ("customer_id");
CREATE UNIQUE INDEX "sales_returns_entity_number" ON "sales_returns" USING btree ("entity_id","number");
CREATE INDEX "sales_returns_order" ON "sales_returns" USING btree ("order_id");
CREATE INDEX "shipment_lines_shipment" ON "shipment_lines" USING btree ("shipment_id");
CREATE INDEX "shipment_lines_order_line" ON "shipment_lines" USING btree ("order_line_id");
CREATE INDEX "shipment_lines_batch" ON "shipment_lines" USING btree ("batch_no");
CREATE UNIQUE INDEX "shipments_order_seq" ON "shipments" USING btree ("order_id","seq");
CREATE INDEX "stock_adjustment_lines_adjustment" ON "stock_adjustment_lines" USING btree ("adjustment_id");
CREATE UNIQUE INDEX "stock_adjustments_entity_number" ON "stock_adjustments" USING btree ("entity_id","number");
CREATE INDEX "stock_movements_entity_product" ON "stock_movements" USING btree ("entity_id","product_id");
CREATE INDEX "stock_movements_batch" ON "stock_movements" USING btree ("entity_id","batch_no");
CREATE UNIQUE INDEX "stocktake_lines_item" ON "stocktake_lines" USING btree ("stocktake_id","product_id");
CREATE UNIQUE INDEX "stocktakes_entity_number" ON "stocktakes" USING btree ("entity_id","number");
CREATE UNIQUE INDEX "suppliers_entity_name" ON "suppliers" USING btree ("entity_id","name");
CREATE INDEX "xero_sync_log_entity_at" ON "xero_sync_log" USING btree ("entity_id","at");
