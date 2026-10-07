import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { saveMailAccount } from "./accounts";
import type { GraphMessage } from "./classify";
import { forgetGraphToken } from "./graph";
import { fileKnownSenders, listSyncStatus, syncMail } from "./sync";
import { addSenderAsContact, ignoreSender, listTriage } from "./triage";

// Outlook sync as crm_app, against a fake Microsoft Graph. Own rows on *.mailtest.test, removed before and after.

let profileId = "";
let janeId = "";
let dealId = "";
const user = () => ({ type: "user" as const, profileId });
const SYS = { type: "system" as const, reason: "import" as const };

async function cleanup() {
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`delete from crm.activities where external_id like '<mailtest-%'`);
    await tx.execute(sql`delete from crm.unmatched_emails where external_id like '<mailtest-%'`);
    await tx.execute(sql`delete from crm.mail_ignore where pattern like '%mailtest.test'`);
    await tx.execute(sql`delete from crm.tasks where deal_id in (select id from crm.deals where title like 'TEST M %')`);
    await tx.execute(sql`delete from crm.deals where title like 'TEST M %'`);
    await tx.execute(sql`delete from crm.contacts where email like '%mailtest.test'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST M %' or domain like '%mailtest.test'`);
    await tx.execute(sql`delete from crm.profiles where display_name = 'TEST Mail Sync'`);
  });
}

beforeAll(async () => {
  vi.stubEnv("MAIL_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("AUTH_SECRET", "s");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ID", "client-id");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_SECRET", "client-secret");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER", "https://login.microsoftonline.com/6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d/v2.0");
  await cleanup();
  await withActor(SYS, async (tx) => {
    [{ id: profileId }] = await rows<{ id: string }>(
      sql`insert into crm.profiles (display_name, email, role) values ('TEST Mail Sync', 'test.sync@saveboard.nz', 'user') returning id`,
      tx,
    );
    const [co] = await rows<{ id: string }>(sql`insert into crm.companies (name, domain) values ('TEST M Builders', 'builder.mailtest.test') returning id`, tx);
    [{ id: janeId }] = await rows<{ id: string }>(
      sql`insert into crm.contacts (first_name, email, company_id) values ('Jane', 'jane@builder.mailtest.test', ${co.id}) returning id`,
      tx,
    );
    [{ id: dealId }] = await rows<{ id: string }>(
      sql`insert into crm.deals (title, company_id, primary_contact_id, entity) values ('TEST M Smith job', ${co.id}, ${janeId}, 'NZ') returning id`,
      tx,
    );
  });
  await saveMailAccount(user(), profileId, "test.sync@saveboard.nz", "refresh-1", "Mail.ReadWrite offline_access");
});
afterAll(async () => {
  await cleanup();
  vi.unstubAllEnvs();
});

const a = (address: string, name?: string) => ({ emailAddress: { address, name } });
let n = 0;
const m = (p: Partial<GraphMessage>): GraphMessage => ({
  id: `id${++n}`,
  internetMessageId: `<mailtest-${n}@x>`,
  subject: `Subject ${n}`,
  receivedDateTime: "2026-10-01T01:00:00Z",
  sentDateTime: "2026-10-01T01:00:00Z",
  webLink: `https://outlook.office365.com/owa/?ItemID=${n}`,
  inferenceClassification: "focused",
  ...p,
});

/** A fake Microsoft: the token endpoint, plus pages of messages per folder; later calls return the "delta" pages. */
function fakeGraph(pages: Record<string, GraphMessage[][]>, later: Record<string, GraphMessage[]> = {}) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url.includes("login.microsoftonline.com")) return json({ access_token: "acc", refresh_token: "refresh-2", expires_in: 3600 });
    const folder = /mailFolders\/(\w+)/.exec(url)?.[1] ?? "";
    const pageNo = Number(new URL(url).searchParams.get("page") ?? 0);
    if (url.includes("deltatoken=")) return json({ value: later[folder] ?? [], "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?deltatoken=2` });
    const list = pages[folder] ?? [[]];
    const body: Record<string, unknown> = { value: list[pageNo] ?? [] };
    if (pageNo + 1 < list.length) body["@odata.nextLink"] = `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?page=${pageNo + 1}`;
    else body["@odata.deltaLink"] = `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?deltatoken=1`;
    return json(body);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("Outlook mail sync", () => {
  it("logs mail with contacts, sends unknown senders to triage, and skips the rest", async () => {
    forgetGraphToken(profileId);
    const inbound = m({ from: a("Jane@builder.mailtest.test", "Jane"), toRecipients: [a("test.sync@saveboard.nz")] });
    const unknown = m({ from: a("newbie@prospect.mailtest.test", "New Person"), toRecipients: [a("test.sync@saveboard.nz")] });
    const robot = m({ from: a("noreply@robot.mailtest.test"), toRecipients: [a("test.sync@saveboard.nz")] });
    const internal = m({ from: a("dave@saveboard.nz"), toRecipients: [a("test.sync@saveboard.nz")] });
    const sent = m({ from: a("test.sync@saveboard.nz"), toRecipients: [a("jane@builder.mailtest.test")], sentDateTime: "2026-10-02T03:00:00Z" });
    const g = fakeGraph({ inbox: [[inbound, unknown], [robot, internal, { ...inbound, id: "dup" }]], sentitems: [[sent]] });

    const [r] = await syncMail({ profileId, fetchImpl: g.impl });
    expect(r.folders).toMatchObject([
      { folder: "inbox", seen: 5, logged: 1, triaged: 1, finished: true },
      { folder: "sentitems", seen: 1, logged: 1, triaged: 0, finished: true },
    ]);
    // The first request reads back 90 days, asks only for header fields (never the body), and pages through.
    const first = new URL(g.calls.find((c) => c.includes("graph.microsoft.com"))!);
    expect(first.pathname).toBe("/v1.0/me/mailFolders/inbox/messages/delta");
    expect(first.searchParams.get("$select")).toMatch(/^internetMessageId,subject,/);
    expect(first.searchParams.get("$filter")).toMatch(/^receivedDateTime ge 20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(g.calls.join(" ")).not.toMatch(/body/i);

    const acts = await rows<{ direction: string; subject: string; deal_id: string; owner_id: string; origin: string; summary: string | null }>(
      sql`select direction, subject, deal_id, owner_id, origin, summary from crm.activities where contact_id = ${janeId} order by occurred_at`,
    );
    expect(acts).toEqual([
      { direction: "inbound", subject: inbound.subject, deal_id: dealId, owner_id: profileId, origin: "graph", summary: null },
      { direction: "outbound", subject: sent.subject, deal_id: dealId, owner_id: profileId, origin: "graph", summary: null },
    ]);
    const [deal] = await rows<{ last_activity_at: string }>(sql`select last_activity_at from crm.deals where id = ${dealId}`);
    expect(new Date(deal.last_activity_at).toISOString()).toBe("2026-10-02T03:00:00.000Z");

    const triage = await listTriage();
    expect(triage.filter((t) => t.from_address.endsWith("mailtest.test"))).toMatchObject([
      { from_address: "newbie@prospect.mailtest.test", from_name: "New Person", emails: 1, company_id: null },
    ]);
    const status = await listSyncStatus(profileId);
    expect(status.map((s) => [s.folder, s.catching_up, s.last_error])).toEqual([
      ["inbox", false, null],
      ["sentitems", false, null],
    ]);
  });

  it("next time, reads only what changed, and never logs the same email twice", async () => {
    const again = m({ from: a("jane@builder.mailtest.test"), internetMessageId: "<mailtest-1@x>" }); // already logged
    const fresh = m({ from: a("jane@builder.mailtest.test") });
    const g = fakeGraph({}, { inbox: [again, fresh] });
    const [r] = await syncMail({ profileId, fetchImpl: g.impl });
    expect(g.calls.filter((c) => c.includes("graph.microsoft.com")).every((c) => c.includes("deltatoken=1"))).toBe(true);
    expect(r.folders[0]).toMatchObject({ seen: 2, logged: 1 });
  });

  it("resumes where it stopped when the time runs out", async () => {
    await withActor(SYS, (tx) => tx.execute(sql`update crm.mail_sync_state set delta_link = null, next_link = null where profile_id = ${profileId}`));
    const g = fakeGraph({ inbox: [[m({ from: a("x@builder.mailtest.test") })], [m({ from: a("y@builder.mailtest.test") })]] });
    const [r] = await syncMail({ profileId, fetchImpl: g.impl, budgetMs: 0 });
    expect(r.folders).toEqual([]); // no time at all: nothing read, nothing lost
    const [r2] = await syncMail({ profileId, fetchImpl: g.impl });
    expect(r2.folders[0]).toMatchObject({ seen: 2, finished: true });
  });

  it("triage: adding the sender as a contact logs their waiting emails; always-ignore skips the domain from then on", async () => {
    const [t] = (await listTriage()).filter((x) => x.from_address === "newbie@prospect.mailtest.test");
    const contactId = await addSenderAsContact(user(), {
      address: t.from_address,
      first_name: "New",
      last_name: "Person",
      company: { newName: "TEST M Prospect Ltd" },
    });
    const [c] = await rows<{ email: string; company: string; domain: string; owner_id: string; acts: number }>(sql`
      select ct.email, co.name as company, co.domain, ct.owner_id,
             (select count(*)::int from crm.activities where contact_id = ct.id and origin = 'graph') as acts
      from crm.contacts ct join crm.companies co on co.id = ct.company_id where ct.id = ${contactId}`);
    expect(c).toEqual({ email: "newbie@prospect.mailtest.test", company: "TEST M Prospect Ltd", domain: "prospect.mailtest.test", owner_id: profileId, acts: 1 });
    expect((await listTriage()).some((x) => x.from_address === "newbie@prospect.mailtest.test")).toBe(false);

    // A second unknown sender from the same company: the company is suggested.
    const g = fakeGraph({}, { inbox: [m({ from: a("other@prospect.mailtest.test") }), m({ from: a("spam@junk.mailtest.test") })] });
    await syncMail({ profileId, fetchImpl: g.impl });
    const list = (await listTriage()).filter((x) => x.from_address.endsWith("mailtest.test"));
    expect(list.find((x) => x.from_address === "other@prospect.mailtest.test")).toMatchObject({ company_name: "TEST M Prospect Ltd" });

    await ignoreSender(user(), "spam@junk.mailtest.test", "domain");
    const [rule] = await rows<{ kind: string }>(sql`select kind from crm.mail_ignore where pattern = 'junk.mailtest.test'`);
    expect(rule.kind).toBe("domain");
    const g2 = fakeGraph({}, { inbox: [m({ from: a("more@junk.mailtest.test") })] });
    const [r] = await syncMail({ profileId, fetchImpl: g2.impl });
    expect(r.folders[0]).toMatchObject({ seen: 1, logged: 0, triaged: 0 });
    await expect(ignoreSender(user(), "someone@gmail.com", "domain")).rejects.toThrow(/free-mail/);
  });

  it("pipeline rules: our email moves a New enquiry deal to Contacted; a reply after the quote suggests Negotiation", async () => {
    await withActor(SYS, (tx) => tx.execute(sql`update crm.deals set stage = 'new_enquiry' where id = ${dealId}`));
    const now = new Date().toISOString();
    // Old mail (before the deal existed) moves nothing.
    await withActor(SYS, (tx) => tx.execute(sql`update crm.mail_sync_state set delta_link = null where profile_id = ${profileId}`));
    const back = fakeGraph({ sentitems: [[m({ from: a("test.sync@saveboard.nz"), toRecipients: [a("jane@builder.mailtest.test")], sentDateTime: "2020-01-01T00:00:00Z" })]] });
    await syncMail({ profileId, fetchImpl: back.impl });
    expect((await rows<{ stage: string }>(sql`select stage from crm.deals where id = ${dealId}`))[0].stage).toBe("new_enquiry");

    const sent = fakeGraph({}, { sentitems: [m({ from: a("test.sync@saveboard.nz"), toRecipients: [a("jane@builder.mailtest.test")], sentDateTime: now })] });
    await syncMail({ profileId, fetchImpl: sent.impl });
    expect((await rows<{ stage: string }>(sql`select stage from crm.deals where id = ${dealId}`))[0].stage).toBe("contacted");
    const [moved] = await rows<{ actor_type: string; changes: { stage: { new: string } } }>(
      sql`select actor_type, changes from crm.audit_log where table_name = 'deals' and record_id = ${dealId} order by id desc limit 1`,
    );
    expect(moved).toMatchObject({ actor_type: "system", changes: { stage: { new: "contacted" } } });

    await withActor(SYS, (tx) => tx.execute(sql`update crm.deals set stage = 'quote_sent' where id = ${dealId}`));
    const reply = () => fakeGraph({}, { inbox: [m({ from: a("jane@builder.mailtest.test"), receivedDateTime: new Date(Date.now() + 1000).toISOString() })] });
    await syncMail({ profileId, fetchImpl: reply().impl });
    await syncMail({ profileId, fetchImpl: reply().impl }); // a second reply: still one suggestion
    const tasks = await rows<{ title: string; rule: string; status: string }>(sql`select title, rule, status from crm.tasks where deal_id = ${dealId}`);
    expect(tasks).toEqual([{ title: "Customer replied after the quote: move to Negotiation?", rule: "suggest_negotiation", status: "open" }]);
    expect((await rows<{ stage: string }>(sql`select stage from crm.deals where id = ${dealId}`))[0].stage).toBe("quote_sent");
  });

  it("files waiting emails once the sender is added as a contact some other way", async () => {
    await withActor(SYS, (tx) =>
      tx.execute(sql`insert into crm.contacts (first_name, email) values ('Other', 'other@prospect.mailtest.test')`),
    );
    expect(await fileKnownSenders()).toBeGreaterThanOrEqual(1);
    const [u] = await rows<{ status: string }>(sql`select status from crm.unmatched_emails where from_address = 'other@prospect.mailtest.test'`);
    expect(u.status).toBe("accepted");
  });
});
