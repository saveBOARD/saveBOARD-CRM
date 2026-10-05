import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { searchAll } from "./search";

// Top-bar search as crm_app. Own "TEST S" rows, removed before and after.

async function cleanup() {
  await withActor({ type: "system", reason: "import" }, async (tx) => {
    await tx.execute(sql`delete from crm.deals where title like 'TEST S %'`);
    await tx.execute(sql`delete from crm.contacts where email like 'test.s.%@example.test'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST S %'`);
  });
}

beforeAll(async () => {
  await cleanup();
  const [{ id: paul }] = await rows<{ id: string }>(sql`select id from crm.profiles where display_name = 'Paul Charteris'`);
  await withActor({ type: "user", profileId: paul }, async (tx) => {
    const [{ id: co }] = await rows<{ id: string }>(
      sql`insert into crm.companies (name, domain) values ('TEST S Quarry Works', 'test-s-quarry.example') returning id`,
      tx,
    );
    await tx.execute(sql`insert into crm.contacts (company_id, first_name, last_name, email, phone_raw, phone_e164)
                         values (${co}, 'Seeker', 'Searchington', 'test.s.seeker@example.test', '021 987 6543', '+64219876543')`);
    // A number that could not be converted to international format: only the raw text is stored.
    await tx.execute(sql`insert into crm.contacts (company_id, first_name, last_name, email, phone_raw)
                         values (${co}, 'Rawly', 'Phoned', 'test.s.rawly@example.test', '(09) 123-4567')`);
    await tx.execute(sql`insert into crm.deals (title, company_id, entity, est_currency, erp_so_number)
                         values ('TEST S quarry fence', ${co}, 'NZ', 'NZD', 'SO-98765')`);
  });
});
afterAll(cleanup);

describe("searchAll", () => {
  it("finds a company by name or web domain", async () => {
    expect((await searchAll("quarry works")).companies.map((c) => c.name)).toContain("TEST S Quarry Works");
    expect((await searchAll("test-s-quarry")).companies[0]).toMatchObject({ name: "TEST S Quarry Works", contacts: 2 });
  });

  it("finds a contact by name, email, or phone digits in any format", async () => {
    for (const q of ["searchington", "test.s.seeker", "021 987 6543", "+64 21 987 6543", "9876543"]) {
      expect((await searchAll(q)).contacts.map((c) => c.name), q).toContain("Seeker Searchington");
    }
  });

  it("finds a contact whose phone is only stored as typed, with spaces and brackets", async () => {
    expect((await searchAll("09 123 4567")).contacts.map((c) => c.name)).toContain("Rawly Phoned");
    expect((await searchAll("1234567")).contacts.map((c) => c.name)).toContain("Rawly Phoned");
  });

  it("finds a deal by title or ERP number, with its company", async () => {
    expect((await searchAll("SO-98765")).deals[0]).toMatchObject({ title: "TEST S quarry fence", company: "TEST S Quarry Works" });
    expect((await searchAll("quarry fence")).deals).toHaveLength(1);
  });

  it("ignores very short searches and treats wildcards as plain text", async () => {
    expect(await searchAll("q")).toEqual({ companies: [], contacts: [], deals: [] });
    const r = await searchAll("%_%");
    expect(r.companies.length + r.contacts.length + r.deals.length).toBe(0);
  });
});
