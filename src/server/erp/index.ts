import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import type { Entity } from "@/lib/format";
import { assertSafeErpColumns } from "./guard";

// The ONLY module that reads ERP data. Everything else asks this module, so the erp_read views can later be
// swapped for the ERP's read-only API without touching the rest of the CRM (brief: ERP boundary).
// Read-only by construction: there is no write helper here. ERP changes go through the ERP app's endpoints.

async function erpRead<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  const rows = (await db().execute(query)) as unknown as T[];
  if (rows.length > 0) assertSafeErpColumns(Object.keys(rows[0]));
  return rows;
}

/** Number of live (not deleted) ERP customers, optionally for one entity. Used by the health check. */
export async function countErpCustomers(entity?: Entity): Promise<number> {
  const rows = await erpRead<{ n: string }>(
    entity
      ? sql`select count(*)::text as n from erp_read.customers where entity_id = ${entity}`
      : sql`select count(*)::text as n from erp_read.customers`,
  );
  return Number(rows[0]?.n ?? 0);
}
