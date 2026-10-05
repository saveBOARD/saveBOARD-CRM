import "server-only";
import { sql } from "drizzle-orm";
import type { Entity } from "@/lib/format";
import { erpRead } from "./read";

export * from "./company";
export * from "./matches";

// The ONLY module that reads ERP data. Everything else asks this module, so the erp_read views can later be
// swapped for the ERP's read-only API without touching the rest of the CRM (brief: ERP boundary).
// Read-only by construction: there is no write helper here. ERP changes go through the ERP app's endpoints.

/** Number of live (not deleted) ERP customers, optionally for one entity. Used by the health check. */
export async function countErpCustomers(entity?: Entity): Promise<number> {
  const rows = await erpRead<{ n: string }>(
    entity
      ? sql`select count(*)::text as n from erp_read.customers where entity_id = ${entity}`
      : sql`select count(*)::text as n from erp_read.customers`,
  );
  return Number(rows[0]?.n ?? 0);
}
