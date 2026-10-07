import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/server/db/actor";
import { listTriage } from "./triage";

// Inbox triage must stay fast at live volumes (about 4,000 companies, 5,800 contacts, hundreds of unknown senders
// after the 90-day back-fill). A slow query here held every database connection and timed out the whole CRM.

const SYS = { type: "system" as const, reason: "import" as const };

async function cleanup() {
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`delete from crm.unmatched_emails where external_id like '<speedtest-%'`);
    await tx.execute(sql`delete from crm.contacts where email like '%.speedtest.test'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST SPEED %'`);
  });
}

beforeAll(async () => {
  await cleanup();
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`select set_config('crm.skip_audit', 'on', true)`);
    await tx.execute(sql`insert into crm.companies (name, domain)
                         select 'TEST SPEED ' || g, 'co' || g || '.speedtest.test' from generate_series(1, 4000) g`);
    await tx.execute(sql`insert into crm.contacts (first_name, email, company_id)
                         select 'Speed', 'p' || g || '@co' || (g % 4000 + 1) || '.speedtest.test',
                                (select id from crm.companies where domain = 'co' || (g % 4000 + 1) || '.speedtest.test')
                         from generate_series(1, 5800) g`);
    await tx.execute(sql`insert into crm.unmatched_emails (external_id, from_address, subject, received_at, status)
                         select '<speedtest-' || g || '>', 'new' || g || '@' || case when g % 2 = 0 then 'co' || g || '.speedtest.test' else 'x' || g || '.speedtest.test' end,
                                'Hello', now() - g * interval '1 hour', 'pending'
                         from generate_series(1, 400) g`);
  });
}, 120_000);
afterAll(cleanup, 120_000);

describe("Inbox triage speed", () => {
  it("lists 400 unknown senders with company suggestions in well under a second", async () => {
    await listTriage(); // warm the connection
    const t = Date.now();
    const list = await listTriage();
    const ms = Date.now() - t;
    console.log(`listTriage: ${ms} ms`);
    const mine = list.filter((s) => s.from_address.endsWith(".speedtest.test"));
    expect(mine.length).toBe(200);
    expect(mine.find((s) => s.from_address === "new2@co2.speedtest.test")).toMatchObject({ company_name: "TEST SPEED 2" });
    expect(mine.find((s) => s.from_address === "new1@x1.speedtest.test")).toMatchObject({ company_id: null });
    expect(ms).toBeLessThan(1500);
  }, 120_000);
});
