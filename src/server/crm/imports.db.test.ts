import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { importHubspotContacts, listImportBatches } from "./imports";

// The in-app HubSpot contacts import (migration 7) as crm_app, with made-up rows ("test-i-" HubSpot ids).

let paul = "";
const FILE = "TEST I contacts.csv";

const row = (o: Record<string, string>) => ({
  record_id: "",
  first_name: "",
  last_name: "",
  email: "",
  phone_number: "",
  city: "",
  company_style: "",
  associated_company: "",
  samples_sent: "",
  country_region: "",
  contact_owner: "",
  last_activity_date: "",
  associated_company_id: "",
  ...o,
});

const FILE_ROWS = [
  row({ record_id: "test-i-1", first_name: "Ida", last_name: "Import", email: "test.i.ida@example.co.nz", phone_number: "021 555 0111",
        company_style: "Builder", associated_company: "TEST I Builders", associated_company_id: "test-i-co-1", samples_sent: "true",
        country_region: "New Zealand", contact_owner: "Mark Stokes", last_activity_date: "2026-09-30 10:00" }),
  row({ record_id: "test-i-2", email: "info@test-i-builders.example", associated_company: "TEST I Builders", associated_company_id: "test-i-co-1" }),
];

async function cleanup() {
  await withActor({ type: "system", reason: "import" }, async (tx) => {
    await tx.execute(sql`delete from crm.contacts where hubspot_id like 'test-i-%'`);
    await tx.execute(sql`delete from crm.companies where hubspot_id like 'test-i-%'`);
    await tx.execute(sql`delete from crm.import_batches where file_name = ${FILE}`);
  });
}

beforeAll(async () => {
  await cleanup();
  [{ id: paul }] = await rows<{ id: string }>(sql`select id from crm.profiles where display_name = 'Paul Charteris'`);
});
afterAll(cleanup);

describe("importHubspotContacts", () => {
  it("loads contacts and their company, cleaning as the loader does", async () => {
    const r = await importHubspotContacts(paul, FILE, FILE_ROWS);
    expect(r).toMatchObject({ rows_read: 2, contacts_created: 2, contacts_updated: 0, companies_created: 1 });
    expect(r.report.some((x) => x.measure === "contacts loaded from HubSpot")).toBe(true);

    const [ida] = await rows<{ phone_e164: string; segment: string; samples_sent: boolean; owner: string; country_code: string }>(sql`
      select ct.phone_e164, ct.segment, ct.samples_sent, p.display_name as owner, ct.country_code
      from crm.contacts ct join crm.profiles p on p.id = ct.owner_id where ct.hubspot_id = 'test-i-1'`);
    expect(ida).toEqual({ phone_e164: "+64215550111", segment: "builder", samples_sent: true, owner: "Mark Atkinson", country_code: "NZ" });
    const [info] = await rows<{ kind: string }>(sql`select kind from crm.contacts where hubspot_id = 'test-i-2'`);
    expect(info.kind).toBe("generic_mailbox");
  });

  it("re-running the same file updates instead of duplicating", async () => {
    const r = await importHubspotContacts(paul, FILE, FILE_ROWS);
    expect(r).toMatchObject({ contacts_created: 0, contacts_updated: 2, companies_created: 0 });
    const [n] = await rows<{ n: number }>(sql`select count(*)::int as n from crm.contacts where hubspot_id like 'test-i-%'`);
    expect(n.n).toBe(2);
  });

  it("records who ran it and leaves no rows behind in staging", async () => {
    const mine = (await listImportBatches()).filter((b) => b.file_name === FILE);
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ kind: "hubspot_contacts", rows_read: 2, created_by: "Paul Charteris" });
    expect(mine[0].finished_at).not.toBeNull();
    // crm_app cannot even look at the staging table; the import function empties it as postgres.
    await expect(rows(sql`select count(*) from crm_staging.hubspot_contacts`)).rejects.toThrow();
  });

  it("refuses rows that don't have exactly the expected columns", async () => {
    await expect(importHubspotContacts(paul, FILE, [{ ...FILE_ROWS[0], extra: "x" }])).rejects.toThrow();
    await expect(importHubspotContacts(paul, FILE, [])).rejects.toThrow(/no contacts/);
  });
});
