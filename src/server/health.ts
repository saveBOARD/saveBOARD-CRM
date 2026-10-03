import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { countErpCustomers } from "@/server/erp";

export type Health =
  | { ok: true; dbUser: string; serverTime: string; erpCustomers: { NZ: number; AUS: number }; crmContacts: number; crmCompanies: number }
  | { ok: false; error: string };

/** Admin health check: who the app connects as, and that it can read the CRM and the ERP views. */
export async function getHealth(): Promise<Health> {
  try {
    const [r] = (await db().execute(sql`
      select current_user as db_user, now() as server_time,
             (select count(*) from crm.contacts where deleted_at is null)::int as contacts,
             (select count(*) from crm.companies where deleted_at is null)::int as companies`)) as unknown as {
      db_user: string;
      server_time: Date;
      contacts: number;
      companies: number;
    }[];
    const [nz, aus] = await Promise.all([countErpCustomers("NZ"), countErpCustomers("AUS")]);
    return {
      ok: true,
      dbUser: r.db_user,
      serverTime: new Date(r.server_time).toISOString(),
      erpCustomers: { NZ: nz, AUS: aus },
      crmContacts: r.contacts,
      crmCompanies: r.companies,
    };
  } catch (e) {
    // Never echo connection strings: report the database's message only.
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return { ok: false, error: cause instanceof Error ? cause.message : "Unknown error" };
  }
}
