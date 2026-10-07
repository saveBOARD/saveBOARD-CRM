import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { SQL } from "drizzle-orm";
import { serverEnv } from "@/server/env";

// One connection pool per server instance, reused across hot reloads in dev (and replaced if the URL changes).
// Supabase's pooler (Supavisor, transaction mode) does not support prepared statements: prepare must stay false.

const DATE_OID = 1082;

function createSql(url: string) {
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1";

  return postgres(url, {
    prepare: false,
    max: local ? 5 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : "require",
    connection: { application_name: "saveboard-crm" },
    // Keep Postgres `date` values as 'YYYY-MM-DD' strings (a date is a calendar day, never time-zone shifted).
    // Drizzle also returns timestamptz as Postgres text ('2026-10-04 07:17:16.1+00'), which new Date() parses;
    // `numeric` comes back as a string too (no float rounding).
    types: {
      date: { to: DATE_OID, from: [DATE_OID], serialize: (v: string) => v, parse: (v: string) => v },
    },
  });
}

function createDb(url: string) {
  return drizzle({ client: createSql(url) });
}

const globalForDb = globalThis as unknown as { crmDb?: { url: string; db: ReturnType<typeof createDb> } };

/** The CRM database, connected as crm_app. For reads; every write goes through `withActor`. */
export function db() {
  const url = serverEnv().databaseUrl;
  const current = globalForDb.crmDb;
  if (!current || current.url !== url) {
    void current?.db.$client.end({ timeout: 5 });
    globalForDb.crmDb = { url, db: createDb(url) };
  }
  return globalForDb.crmDb!.db;
}

export type Db = ReturnType<typeof db>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A read that hasn't answered by now is stuck (Postgres itself cancels anything over 30 s, migration 11). */
const STUCK_MS = 35_000;

export class QueryStuck extends Error {
  constructor() {
    super("The database didn't answer in time; please try again.");
    this.name = "QueryStuck";
  }
}

/**
 * A connection can be left waiting for an answer that never comes (seen live on 8 Oct 2026: a query sat for minutes in
 * "ClientRead" and the page never loaded). Then drop this server's pool, so the next query opens fresh connections,
 * instead of every later request queueing behind it.
 */
function resetPool(reason: string) {
  const current = globalForDb.crmDb;
  if (!current) return;
  globalForDb.crmDb = undefined;
  console.warn(`[db] connection pool reset: ${reason}`);
  void current.db.$client.end({ timeout: 1 }).catch(() => {});
}

/** Run a read query and return its rows, typed by the caller. Pass `tx` to read inside a withActor transaction. */
export async function rows<T>(query: SQL, tx?: Tx): Promise<T[]> {
  if (tx) return (await tx.execute(query)) as unknown as T[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stuck = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      resetPool(`a read took over ${STUCK_MS / 1000} s`);
      reject(new QueryStuck());
    }, STUCK_MS);
  });
  try {
    return (await Promise.race([db().execute(query), stuck])) as unknown as T[];
  } finally {
    clearTimeout(timer);
  }
}
