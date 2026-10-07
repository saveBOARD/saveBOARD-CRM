import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { importEmailEvents, importNotes, listUnlinkedHubspotNotes } from "./imports";
import { createContact } from "./writes";
import { contactSchema } from "./schemas";

// Migration 8 as crm_app: email consent (suppression list) and HubSpot notes. Made-up "test-c" data.

let paul = "";
let companyId = "";
const FILES = "TEST C campaigns.csv";

async function cleanup() {
  await withActor({ type: "system", reason: "import" }, async (tx) => {
    await tx.execute(sql`delete from crm.activities where hubspot_id like 'test-c-%'`);
    await tx.execute(sql`delete from crm.contacts where email like '%@test-c.example'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST C %'`);
    await tx.execute(sql`delete from crm.email_suppressions where email like '%@test-c.example'`);
    await tx.execute(sql`delete from crm.import_batches where file_name in (${FILES}, 'TEST C notes.csv')`);
  });
}

const stats = { files: 1, rows: 3, recipients: 3, unsubscribed: 1, bounced: 2, soft_only: 0 };
const consent = async (email: string) =>
  (await rows<{ consent_status: string; consent_source: string | null }>(sql`select consent_status, consent_source from crm.contacts where lower(email) = lower(${email})`))[0];

beforeAll(async () => {
  await cleanup();
  [{ id: paul }] = await rows<{ id: string }>(sql`select id from crm.profiles where display_name = 'Paul Charteris'`);
  await withActor({ type: "user", profileId: paul }, async (tx) => {
    [{ id: companyId }] = await rows<{ id: string }>(sql`insert into crm.companies (name, hubspot_id) values ('TEST C Cladders Ltd', 'test-c-co-1') returning id`, tx);
    await tx.execute(sql`insert into crm.contacts (email, first_name, company_id) values
      ('unsub@test-c.example', 'Una', ${companyId}), ('gone@test-c.example', 'Gone', null), ('both@test-c.example', 'Bo', null)`);
  });
});
afterAll(cleanup);

describe("email consent", () => {
  it("marks contacts unsubscribed or bounced and keeps everyone on the suppression list", async () => {
    const r = await importEmailEvents(paul, FILES, [
      { email: "unsub@test-c.example", status: "unsubscribed", reason: "clicked unsubscribe", occurred_at: "3/02/2026 09:00" },
      { email: "gone@test-c.example", status: "bounced", reason: "unknown user", occurred_at: "1/02/2026 09:00" },
      { email: "notyet@test-c.example", status: "unsubscribed", reason: "already unsubscribed", occurred_at: "" },
    ], stats);
    expect(r).toMatchObject({ suppression_list: 3, contacts_unsubscribed: 1, contacts_bounced: 1 });
    expect(await consent("unsub@test-c.example")).toEqual({ consent_status: "unsubscribed", consent_source: "HubSpot campaign (clicked unsubscribe)" });
    expect((await consent("gone@test-c.example")).consent_status).toBe("bounced");
    expect((await consent("both@test-c.example")).consent_status).toBe("unknown");
  });

  it("unsubscribed outranks bounced, and nothing is ever downgraded", async () => {
    await importEmailEvents(paul, FILES, [
      { email: "both@test-c.example", status: "unsubscribed", reason: "reported spam", occurred_at: "" },
      { email: "unsub@test-c.example", status: "bounced", reason: "previously bounced", occurred_at: "" },
    ], stats);
    expect((await consent("both@test-c.example")).consent_status).toBe("unsubscribed");
    expect((await consent("unsub@test-c.example")).consent_status).toBe("unsubscribed");
    const [s] = await rows<{ status: string }>(sql`select status from crm.email_suppressions where email = 'unsub@test-c.example'`);
    expect(s.status).toBe("unsubscribed");
  });

  it("someone on the list who is added later is marked automatically", async () => {
    await createContact(
      { type: "user", profileId: paul },
      contactSchema.parse({
        first_name: "Late", last_name: "", email: "NotYet@test-c.example", phone: "", role_title: "", company_id: "", kind: "person",
        segment: "unknown", country_code: "", city: "", samples_sent: false, track_followup: false, owner_id: "", notes: "",
      }),
    );
    const c = await consent("notyet@test-c.example");
    expect(c.consent_status).toBe("unsubscribed");
    expect(c.consent_source).toContain("Suppression list");
  });
});

describe("HubSpot notes", () => {
  const note = (o: Record<string, unknown>) => ({
    record_id: "", body: "", activity_date: "1/10/2026 21:52", contact_emails: [], contact_ids: [], company_ids: [], company_names: [],
    contact_text: "", company_text: "", ...o,
  });
  const NOTES = [
    note({ record_id: "test-c-n1", body: "Called Una about samples", contact_emails: ["unsub@test-c.example"], contact_ids: ["999"] }),
    note({ record_id: "test-c-n2", body: "Met the cladders", company_names: ["TEST C Cladders Limited"] }),
    note({ record_id: "test-c-n3", body: "Deal note", contact_text: "Someone (someone@elsewhere.example)" }),
  ];

  it("links notes by contact email, then company name, and keeps the rest unlinked", async () => {
    const r = await importNotes(paul, "TEST C notes.csv", NOTES);
    expect(r).toMatchObject({ rows_read: 3, notes_created: 3, linked_to_contact: 1, company_only: 1, not_linked: 1 });
    const [n1] = await rows<{ contact_id: string; company_id: string; occurred_at: string }>(
      sql`select contact_id, company_id, occurred_at from crm.activities where hubspot_id = 'test-c-n1'`,
    );
    expect(n1.company_id).toBe(companyId); // from the contact's company
    expect(new Date(n1.occurred_at).toISOString()).toBe("2026-10-01T08:52:00.000Z"); // 21:52 NZDT
    expect((await listUnlinkedHubspotNotes()).map((n) => n.summary)).toContain("Deal note");
  });

  it("re-loading updates instead of duplicating", async () => {
    const r = await importNotes(paul, "TEST C notes.csv", NOTES);
    expect(r).toMatchObject({ notes_created: 0, notes_updated: 3 });
  });

  it("refuses badly shaped rows", async () => {
    await expect(importNotes(paul, "TEST C notes.csv", [{ record_id: "x" }])).rejects.toThrow();
  });
});
