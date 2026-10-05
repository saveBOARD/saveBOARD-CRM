import "server-only";
import type { SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { assertSafeErpColumns } from "./guard";

/** Every ERP read goes through here: rows are checked for forbidden (cost, password, token) columns. */
export async function erpRead<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  const rows = (await db().execute(query)) as unknown as T[];
  if (rows.length > 0) assertSafeErpColumns(Object.keys(rows[0]));
  return rows;
}

export const ENTITY_CURRENCY = { NZ: "NZD", AUS: "AUD" } as const;
