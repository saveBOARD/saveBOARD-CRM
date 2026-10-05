import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { companySchema, contactSchema } from "./schemas";
import {
  addNote,
  createCompany,
  createContact,
  findCompanyDuplicates,
  findContactByEmail,
  listUsers,
  searchCompanies,
  softDelete,
  updateCompany,
  updateContact,
} from "./writes";

// Writes as crm_app. Own "TEST W ..." rows, removed before and after (audit rows stay: the log is append-only).

let paulId = "";
const user = () => ({ type: "user" as const, profileId: paulId });

async function cleanup() {
  await withActor({ type: "system", reason: "import" }, async (tx) => {
    await tx.execute(sql`delete from crm.activities where summary like 'TEST W %'`);
    await tx.execute(sql`delete from crm.contacts where email like 'test.w.%@example.test' or first_name = 'TEST W'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST W %'`);
  });
}

const company = (o: Record<string, unknown> = {}) =>
  companySchema.parse({ name: "TEST W Roofing Ltd", domain: "", website: "", segment: "builder", country_code: "NZ", city: "", owner_id: "", notes: "", ...o });
const contact = (o: Record<string, unknown> = {}) =>
  contactSchema.parse({
    first_name: "TEST W",
    last_name: "Person",
    email: "test.w.person@example.test",
    phone: "021 555 0101",
    role_title: "",
    company_id: "",
    kind: "person",
    segment: "unknown",
    country_code: "",
    city: "",
    samples_sent: false,
    track_followup: false,
    owner_id: "",
    notes: "",
    ...o,
  });

beforeAll(async () => {
  await cleanup();
  [{ id: paulId }] = await rows<{ id: string }>(sql`select id from crm.profiles where display_name = 'Paul Charteris'`);
});
afterAll(cleanup);

describe("companies", () => {
  it("creates a company and records who did it", async () => {
    const id = await createCompany(user(), company({ domain: "testw-roofing.example" }));
    const [a] = await rows<{ actor_type: string; actor_id: string }>(
      sql`select actor_type, actor_id from crm.audit_log where table_name = 'companies' and record_id = ${id} and action = 'INSERT'`,
    );
    expect(a).toEqual({ actor_type: "user", actor_id: paulId });
  });

  it("spots a likely duplicate by name (ignoring Ltd) or by web domain", async () => {
    const byName = await findCompanyDuplicates({ name: "Test W Roofing", domain: null });
    expect(byName.map((d) => d.reason)).toEqual(["same name"]);
    const byDomain = await findCompanyDuplicates({ name: "Something Else", domain: "testw-roofing.example" });
    expect(byDomain.map((d) => d.reason)).toEqual(["same web domain"]);
  });

  it("updates a company and logs only what changed", async () => {
    const [{ id }] = await rows<{ id: string }>(sql`select id from crm.companies where name = 'TEST W Roofing Ltd'`);
    await updateCompany(user(), id, company({ domain: "testw-roofing.example", segment: "merchant", city: "Hamilton" }));
    const [a] = await rows<{ changes: Record<string, unknown> }>(
      sql`select changes from crm.audit_log where record_id = ${id} and action = 'UPDATE' order by id desc limit 1`,
    );
    expect(Object.keys(a.changes).sort()).toEqual(["city", "segment"]);
    expect(await findCompanyDuplicates({ name: "TEST W Roofing Ltd", domain: null }, id)).toEqual([]);
  });

  it("finds companies by part of the name or domain", async () => {
    expect((await searchCompanies("w roofing")).map((c) => c.name)).toContain("TEST W Roofing Ltd");
    expect(await searchCompanies("w")).toEqual([]);
    // Wildcards in the search text are treated as plain characters.
    expect(await searchCompanies("%%%")).toEqual([]);
  });
});

describe("contacts", () => {
  it("creates a contact with a normalised phone, using the company's country", async () => {
    const [{ id: companyId }] = await rows<{ id: string }>(sql`select id from crm.companies where name = 'TEST W Roofing Ltd'`);
    const id = await createContact(user(), contact({ company_id: companyId }));
    const [c] = await rows<{ phone_e164: string; source: string; consent_status: string }>(
      sql`select phone_e164, source, consent_status from crm.contacts where id = ${id}`,
    );
    expect(c).toEqual({ phone_e164: "+64215550101", source: "manual", consent_status: "unknown" });
  });

  it("knows when an email is already used", async () => {
    expect((await findContactByEmail("TEST.W.PERSON@example.test"))?.reason).toBe("same email");
    expect(await findContactByEmail("nobody@example.test")).toBeNull();
  });

  it("updates a contact", async () => {
    const dup = await findContactByEmail("test.w.person@example.test");
    await updateContact(user(), dup!.id, contact({ role_title: "Estimator", samples_sent: true }));
    const [c] = await rows<{ role_title: string; samples_sent: boolean }>(sql`select role_title, samples_sent from crm.contacts where id = ${dup!.id}`);
    expect(c).toEqual({ role_title: "Estimator", samples_sent: true });
  });
});

describe("notes and deletes", () => {
  it("adds a note that resets the contact's clock, dated midday NZ time when a date is given", async () => {
    const dup = await findContactByEmail("test.w.person@example.test");
    await addNote(user(), { contactId: dup!.id }, { summary: "TEST W called about the March order", occurred_on: "2026-09-30" });
    const [a] = await rows<{ type: string; occurred_at: string; owner_id: string }>(
      sql`select type, occurred_at, owner_id from crm.activities where summary = 'TEST W called about the March order'`,
    );
    expect(a.type).toBe("note");
    expect(a.owner_id).toBe(paulId);
    expect(new Date(a.occurred_at).toISOString()).toBe("2026-09-29T23:00:00.000Z"); // 12:00 NZDT
    const [c] = await rows<{ last_activity_at: string }>(sql`select last_activity_at from crm.contacts where id = ${dup!.id}`);
    expect(new Date(c.last_activity_at).toISOString()).toBe("2026-09-29T23:00:00.000Z");
  });

  it("soft-deletes: the record stays but drops out of look-ups", async () => {
    const dup = await findContactByEmail("test.w.person@example.test");
    await softDelete(user(), "contacts", dup!.id);
    expect(await findContactByEmail("test.w.person@example.test")).toBeNull();
    const [c] = await rows<{ n: number }>(sql`select count(*)::int as n from crm.contacts where id = ${dup!.id}`);
    expect(c.n).toBe(1);
  });

  it("lists the active users for owner menus", async () => {
    expect((await listUsers()).map((u) => u.name)).toEqual(expect.arrayContaining(["Dave Elder", "Iris Lim", "Mark Atkinson", "Paul Charteris"]));
  });
});
