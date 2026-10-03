import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { serverEnv } from "@/server/env";

// One connection pool per server instance, reused across hot reloads in dev.
// Supabase's pooler (Supavisor, transaction mode) does not support prepared statements: prepare must stay false.

const DATE_OID = 1082;

function createSql() {
  const url = serverEnv().databaseUrl;
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1";

  return postgres(url, {
    prepare: false,
    max: local ? 5 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : "require",
    connection: { application_name: "saveboard-crm" },
    // Keep Postgres `date` values as 'YYYY-MM-DD' strings. Parsing them into JS Dates shifts them by the
    // server's time zone; a date is a calendar day. `numeric` already comes back as a string (no float rounding).
    types: {
      date: { to: DATE_OID, from: [DATE_OID], serialize: (v: string) => v, parse: (v: string) => v },
    },
  });
}

const globalForDb = globalThis as unknown as { crmSql?: postgres.Sql<{ date: string }> };

function sqlClient() {
  globalForDb.crmSql ??= createSql();
  return globalForDb.crmSql;
}

let database: ReturnType<typeof drizzle> | undefined;

/** The CRM database, connected as crm_app. For reads; every write goes through `withActor`. */
export function db() {
  database ??= drizzle({ client: sqlClient() });
  return database;
}

export type Db = ReturnType<typeof db>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
