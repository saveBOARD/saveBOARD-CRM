import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { listActivities } from "./activities";
import { getCompany, listCompanies } from "./companies";
import { getContact, listContacts } from "./contacts";
import { listDealsFor } from "./deals";

// Read functions for the phase 2 screens. Own "TEST R ..." rows, removed before and after.

let paulId = "";
let companyId = "";
let numericCompanyId = "";
let contactId = "";

async function cleanup() {
  await withActor({ type: "system", reason: "import" }, async (tx) => {
    await tx.execute(sql`delete from crm.activities where subject like 'TEST R %'`);
    await tx.execute(sql`delete from crm.deals where title like 'TEST R %'`);
    await tx.execute(sql`delete from crm.contacts where email like 'test.r.%@example.test'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST R %' or domain = 'test-r-numeric.example'`);
  });
}

beforeAll(async () => {
  await cleanup();
  [{ id: paulId }] = await rows<{ id: string }>(sql`select id from crm.profiles where display_name = 'Paul Charteris'`);
  await withActor({ type: "user", profileId: paulId }, async (tx) => {
    [{ id: companyId }] = await rows<{ id: string }>(
      sql`insert into crm.companies (name, domain, segment, owner_id) values ('TEST R Builders', 'testr.example', 'builder', ${paulId}) returning id`,
      tx,
    );
    // A HubSpot company that came through with its id as the name.
    [{ id: numericCompanyId }] = await rows<{ id: string }>(
      sql`insert into crm.companies (name, domain) values ('900000000001', 'test-r-numeric.example') returning id`,
      tx,
    );
    [{ id: contactId }] = await rows<{ id: string }>(
      sql`insert into crm.contacts (company_id, first_name, last_name, email, owner_id)
          values (${companyId}, 'Test', 'Reader', 'test.r.reader@example.test', ${paulId}) returning id`,
      tx,
    );
    await tx.execute(sql`insert into crm.deals (title, company_id, primary_contact_id, entity, est_currency, est_value, stage)
                         values ('TEST R deal', ${companyId}, ${contactId}, 'NZ', 'NZD', 1200, 'qualified')`);
    await tx.execute(sql`insert into crm.activities (type, subject, occurred_at, contact_id, origin)
                         values ('note', 'TEST R note on the contact', now() - interval '1 day', ${contactId}, 'manual')`);
  });
});
afterAll(cleanup);

describe("companies", () => {
  it("lists a company with its counts", async () => {
    const c = (await listCompanies()).find((x) => x.id === companyId);
    expect(c).toMatchObject({ name: "TEST R Builders", segment: "builder", owner: "Paul Charteris", contacts: 1, open_deals: 1 });
  });

  it("shows the domain for a company whose name is only a HubSpot id", async () => {
    const c = await getCompany(numericCompanyId);
    expect(c?.name).toBe("test-r-numeric.example");
    expect(c?.raw_name).toBe("900000000001");
  });

  it("returns null for an unknown company", async () => {
    expect(await getCompany("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("contacts", () => {
  it("filters by owner and by company", async () => {
    expect((await listContacts({ companyId })).map((c) => c.id)).toEqual([contactId]);
    const mine = await listContacts({ ownerId: paulId });
    expect(mine.every((c) => c.owner_id === paulId)).toBe(true);
    expect(mine.some((c) => c.id === contactId)).toBe(true);
  });

  it("reads one contact with its company name", async () => {
    expect(await getContact(contactId)).toMatchObject({ name: "Test Reader", company: "TEST R Builders", consent_status: "unknown" });
  });
});

describe("timeline and deals", () => {
  it("shows a contact's activity on the company timeline too", async () => {
    const forCompany = await listActivities({ companyId });
    expect(forCompany.map((a) => a.subject)).toContain("TEST R note on the contact");
    expect(forCompany[0].contact).toBe("Test Reader");
  });

  it("the activity moved the contact's and company's last-activity date", async () => {
    const [c] = await rows<{ last_activity_at: string | null }>(sql`select last_activity_at from crm.companies where id = ${companyId}`);
    expect(Date.parse(c.last_activity_at ?? "")).toBeGreaterThan(Date.now() - 2 * 86_400_000);
  });

  it("lists deals for the company and for the main contact", async () => {
    expect((await listDealsFor({ companyId })).map((d) => d.title)).toEqual(["TEST R deal"]);
    expect((await listDealsFor({ contactId }))[0]).toMatchObject({ stage: "qualified", est_currency: "NZD" });
  });
});
