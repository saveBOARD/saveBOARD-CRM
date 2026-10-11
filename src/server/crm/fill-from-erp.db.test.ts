import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { fillGapsFromErp } from "./quote-links";

// ERP -> CRM gap filling (migration 18), against the local made-up ERP customer "Acme Builders Limited" (phone
// 07 555 0100, contact Sam Acme, accounts@acmebuild.example, 5 Sample Street, Hamilton 3200). Own rows: 'TEST F ...'.

const SYS = { type: "system" as const, reason: "import" as const };
const ACME = "20000000-0000-0000-0000-000000000002";
let companyId = "";

async function cleanup() {
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`delete from crm.contacts where lower(email) = 'accounts@acmebuild.example'`);
    await tx.execute(sql`delete from crm.company_erp_links where erp_customer_id = ${ACME}`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST F %'`);
  });
}

beforeAll(async () => {
  await cleanup();
  [{ id: companyId }] = await withActor(SYS, async (tx) => {
    const r = await rows<{ id: string }>(sql`insert into crm.companies (name, city) values ('TEST F Acme', null) returning id`, tx);
    await tx.execute(sql`insert into crm.company_erp_links (company_id, erp_entity, erp_customer_id, confirmed) values (${r[0].id}, 'NZ', ${ACME}, true)`);
    return r;
  });
});
afterAll(cleanup);

describe("fill gaps from the ERP", () => {
  it("fills the company's empty phone, address, city, domain and country, and adds the ERP's main contact", async () => {
    const r = await fillGapsFromErp();
    expect(r.companies_filled).toBeGreaterThanOrEqual(1);
    const [co] = await rows<{ phone: string; address: string; city: string; domain: string; country_code: string }>(
      sql`select phone, address, city, domain, country_code from crm.companies where id = ${companyId}`,
    );
    expect(co).toEqual({ phone: "07 555 0100", address: "5 Sample Street, Hamilton, 3200", city: "Hamilton", domain: "acmebuild.example", country_code: "NZ" });
    const [ct] = await rows<{ first_name: string; last_name: string; phone_raw: string; phone_e164: string; kind: string; source: string }>(
      sql`select first_name, last_name, phone_raw, phone_e164, kind, source from crm.contacts where lower(email) = 'accounts@acmebuild.example' and company_id = ${companyId}`,
    );
    expect(ct).toEqual({ first_name: "Sam", last_name: "Acme", phone_raw: "07 555 0100", phone_e164: "+6475550100", kind: "generic_mailbox", source: "erp" });
    const [audit] = await rows<{ actor_type: string }>(sql`select actor_type from crm.audit_log where table_name = 'companies' and record_id = ${companyId} order by id desc limit 1`);
    expect(audit.actor_type).toBe("system");
  });

  it("never overwrites what the CRM has, and runs again without changing anything", async () => {
    await withActor(SYS, (tx) => tx.execute(sql`update crm.companies set phone = '021 999 9999', address = 'Our own address' where id = ${companyId}`));
    await fillGapsFromErp();
    const [co] = await rows<{ phone: string; address: string }>(sql`select phone, address from crm.companies where id = ${companyId}`);
    expect(co).toEqual({ phone: "021 999 9999", address: "Our own address" });
    const again = await fillGapsFromErp();
    const [n] = await rows<{ n: number }>(sql`select count(*)::int as n from crm.contacts where lower(email) = 'accounts@acmebuild.example'`);
    expect(n.n).toBe(1);
    expect(again.contacts_added).toBe(0);
  });

  it("fills a contact's missing phone, and never brings back a deleted contact", async () => {
    await withActor(SYS, (tx) => tx.execute(sql`update crm.contacts set phone_raw = null, phone_e164 = null where lower(email) = 'accounts@acmebuild.example'`));
    await fillGapsFromErp();
    const [p] = await rows<{ phone_raw: string }>(sql`select phone_raw from crm.contacts where lower(email) = 'accounts@acmebuild.example'`);
    expect(p.phone_raw).toBe("07 555 0100");

    await withActor(SYS, (tx) => tx.execute(sql`update crm.contacts set deleted_at = now() where lower(email) = 'accounts@acmebuild.example'`));
    const r = await fillGapsFromErp();
    expect(r.contacts_added).toBe(0);
    const [live] = await rows<{ n: number }>(sql`select count(*)::int as n from crm.contacts where lower(email) = 'accounts@acmebuild.example' and deleted_at is null`);
    expect(live.n).toBe(0);
  });
});
