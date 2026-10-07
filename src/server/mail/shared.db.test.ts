import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import type { EnquiryExtractor, ExtractedEnquiry, OrderExtractor } from "@/server/claude/enquiry";
import { saveMailAccount } from "./accounts";
import type { GraphMessage } from "./classify";
import { processWebEnquiries } from "./enquiries";
import { forgetGraphToken } from "./graph";
import { listSharedStatus, syncSharedMailboxes } from "./shared";

// Shared mailboxes and website forms as crm_app, against a fake Outlook and a fake Claude.
// Own rows: *.enqtest.test addresses, '<enqtest-...>' message ids, 'TEST E ...' names.

const SYS = { type: "system" as const, reason: "import" as const };
const SALES = "sales@saveboard.com.au";
const ENQ = "enquiries@saveboard.nz";
let readerId = "";
let knownId = "";

async function cleanup() {
  await withActor(SYS, async (tx) => {
    const mine = sql`(select id from crm.contacts where email like '%enqtest.test')`;
    await tx.execute(sql`delete from crm.activities where external_id like '<enqtest-%' or contact_id in ${mine}`);
    await tx.execute(sql`delete from crm.unmatched_emails where external_id like '<enqtest-%'`);
    await tx.execute(sql`delete from crm.web_enquiries where external_id like '<enqtest-%'`);
    await tx.execute(sql`delete from crm.deals where primary_contact_id in ${mine} or title like '%TEST E %'`);
    await tx.execute(sql`delete from crm.contacts where email like '%enqtest.test'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST E %' or domain like '%enqtest.test'`);
    await tx.execute(sql`delete from crm.shared_mail_folders where mailbox in (${SALES}, ${ENQ})`);
    await tx.execute(sql`delete from crm.profiles where display_name = 'TEST Enq Reader'`);
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
    [{ id: readerId }] = await rows<{ id: string }>(
      sql`insert into crm.profiles (display_name, email, role) values ('TEST Enq Reader', 'enq.reader@saveboard.nz', 'admin') returning id`,
      tx,
    );
    [{ id: knownId }] = await rows<{ id: string }>(sql`insert into crm.contacts (first_name, email) values ('Known', 'known@cust.enqtest.test') returning id`, tx);
    // Someone already on the do-not-email list who ticks "subscribe" must stay unsubscribed.
    await tx.execute(sql`insert into crm.email_suppressions (email, status, reason, source) values ('optout@b.enqtest.test', 'unsubscribed', 'test', 'test')
                         on conflict (email) do nothing`);
  });
  await saveMailAccount({ type: "user", profileId: readerId }, readerId, "enq.reader@saveboard.nz", "refresh-1", "Mail.ReadWrite Mail.Read.Shared");
  forgetGraphToken(readerId);
});
afterAll(async () => {
  await withActor(SYS, (tx) => tx.execute(sql`delete from crm.email_suppressions where email = 'optout@b.enqtest.test'`));
  await cleanup();
  vi.unstubAllEnvs();
});

const a = (address: string, name?: string) => ({ emailAddress: { address, name } });
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const m = (id: string, key: string, p: Partial<GraphMessage>): GraphMessage => ({
  id,
  internetMessageId: `<enqtest-${key}@x>`,
  receivedDateTime: days(1),
  webLink: `https://outlook.office365.com/owa/?ItemID=${id}`,
  inferenceClassification: "focused",
  ...p,
});
const FORM_AU = "A site visitor just submitted your form Form 5 on Save Board AU";
const FORM_NZ = "A site visitor just submitted your form saveBOARD Enquiries Form 2 on Save Board NZ";

/** Fake Outlook for the two shared mailboxes: folder tree, change tracking per folder, message text. */
function fakeOutlook(
  folders: Record<string, { id: string; name: string; kids?: string[]; system?: string }[]>,
  messages: Record<string, GraphMessage[]>,
) {
  const calls: string[] = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const all = Object.values(messages).flat();
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = decodeURIComponent(String(input));
    calls.push(url);
    if (url.includes("login.microsoftonline.com")) return json({ access_token: "acc", expires_in: 3600 });
    const box = /\/users\/([^/]+)\//.exec(url)?.[1] ?? "";
    const tree = folders[box];
    if (!tree) return json({ error: { code: "ErrorAccessDenied" } }, 403);
    const asFolder = (f: { id: string; name: string; kids?: string[] }) => ({ id: f.id, displayName: f.name, childFolderCount: f.kids?.length ?? 0 });
    if (url.includes("/mailFolders/inbox?")) return json(asFolder(tree[0]));
    const wellKnown = /mailFolders\/(\w+)\?\$select=id$/.exec(url)?.[1];
    if (wellKnown) {
      const f = tree.find((x) => x.system === wellKnown);
      return f ? json({ id: f.id }) : json({ error: { code: "ErrorFolderNotFound" } }, 404);
    }
    if (url.includes("/mailFolders?")) {
      const kidIds = new Set(tree.flatMap((f) => f.kids ?? []));
      return json({ value: tree.filter((f) => !kidIds.has(f.id)).map(asFolder) });
    }
    const kids = /mailFolders\/([^/?]+)\/childFolders/.exec(url);
    if (kids) {
      const parent = tree.find((f) => f.id === kids[1]);
      return json({ value: (parent?.kids ?? []).map((k) => ({ id: k, displayName: tree.find((f) => f.id === k)!.name, childFolderCount: 0 })) });
    }
    const delta = /mailFolders\/([^/?]+)\/messages\/delta/.exec(url);
    if (delta) return json({ value: url.includes("deltatoken") ? [] : (messages[delta[1]] ?? []), "@odata.deltaLink": `https://graph.microsoft.com/v1.0/users/${box}/mailFolders/${delta[1]}/messages/delta?deltatoken=1` });
    // Message text for the form extractor: the subject is enough for the fake Claude.
    const byId = /\/messages\/([^/?]+)\?/.exec(url)?.[1];
    const hit = all.find((x) => x.id === byId) ?? all.find((x) => url.includes(x.internetMessageId!));
    return hit ? json({ uniqueBody: { content: `FORM ${hit.internetMessageId}` }, from: a("noreply@forms.example") }) : json({ value: [] });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const form = (o: Partial<ExtractedEnquiry>): ExtractedEnquiry => ({
  is_enquiry: true,
  first_name: null,
  last_name: null,
  email: null,
  phone: null,
  company: null,
  region: null,
  postcode: null,
  customer_type: null,
  products: [],
  heard_about: null,
  subscribe: null,
  summary: "Wants pricing on panels.",
  next_step: "Call back",
  ...o,
});

/** The fake Claude: what each form "says", keyed by its message id. */
const FORMS: Record<string, ExtractedEnquiry> = {
  "<enqtest-f1@x>": form({ first_name: "Ann", last_name: "Lee", email: "Ann@Build.enqtest.test", phone: "0412 345 678", company: "TEST E Build Co", region: "NSW", customer_type: "Builder", products: ["Wall panels"], subscribe: true }),
  "<enqtest-f2@x>": form({ first_name: "Opt", last_name: "Out", email: "optout@b.enqtest.test", phone: "0400 000 000", subscribe: true }),
  "<enqtest-f3@x>": form({ first_name: "Old", last_name: "Kiwi", email: "old@nz.enqtest.test", phone: "021 555 0101" }),
  "<enqtest-f4@x>": form({ is_enquiry: false, summary: "Spam" }),
};
const extract: EnquiryExtractor = async ({ text }) => FORMS[/<enqtest-[^>]+>/.exec(text)![0]];
const extractOrder: OrderExtractor = async () => ({
  is_order: true,
  order_number: "1042",
  first_name: "Sam",
  last_name: "Buyer",
  email: "sam@shop.enqtest.test",
  phone: "021 444 5555",
  company: null,
  country: "NZ",
  city: "Christchurch",
  items: [{ name: "Sample pack", quantity: 2 }],
  is_sample_order: true,
  summary: "Ordered 2 sample packs for delivery to Christchurch.",
});

describe("shared mailboxes and website forms", () => {
  it("reads the Inbox and the folders under it, queues forms and orders, logs the rest", async () => {
    const formAu = m("s1", "f1", { subject: FORM_AU, from: a("noreply@forms.example") });
    const g = fakeOutlook(
      {
        [SALES]: [
          // As in Paul's sales@: "Enquiries" sits beside the Inbox; a subfolder under the Inbox too; Sent Items skipped.
          { id: "sales-inbox", name: "Inbox", kids: ["sales-2026"] },
          { id: "sales-2026", name: "2026" },
          { id: "sales-enq", name: "Enquiries" },
          { id: "sales-sent", name: "Sent Items", system: "sentitems" },
        ],
        [ENQ]: [{ id: "enq-inbox", name: "Inbox" }],
      },
      {
        "sales-sent": [m("sx", "never", { subject: FORM_AU, from: a("noreply@forms.example") })],
        "sales-inbox": [
          formAu,
          m("s2", "f2", { subject: FORM_AU, from: a("noreply@forms.example") }),
          m("s3", "o1", { subject: "New Order Received! Order #1042", from: a("shop@store.example") }),
          m("s4", "c1", { subject: "Re: delivery", from: a("known@cust.enqtest.test"), toRecipients: [a(SALES)] }),
          m("s5", "u1", { subject: "Question", from: a("stranger@new.enqtest.test", "New Person"), toRecipients: [a(SALES)] }),
          m("s9", "f4", { subject: FORM_AU, from: a("noreply@forms.example") }),
        ],
        // The same AUS form, already filed into Inbox/Enquiries by staff: a different id, the same message.
        "sales-enq": [m("s1-moved", "f1", { subject: FORM_AU, from: a("noreply@forms.example") })],
        "enq-inbox": [m("n1", "f3", { subject: FORM_NZ, from: a("noreply@forms.example"), receivedDateTime: days(30) })],
      },
    );
    // A form read earlier as plain email (before it was recognised) sits in triage: recognising it clears that copy.
    await withActor(SYS, (tx) =>
      tx.execute(sql`insert into crm.unmatched_emails (owner_id, external_id, from_address, subject, received_at, status)
                     values (${readerId}, '<enqtest-f2@x>', 'visitor@b.enqtest.test', 'Form', now(), 'pending')`),
    );
    const results = await syncSharedMailboxes({ deadline: Date.now() + 30_000, ignore: new Set(), backfillDays: 90, fetchImpl: g.impl, onlyReader: readerId });
    const [earlier] = await rows<{ status: string }>(sql`select status from crm.unmatched_emails where external_id = '<enqtest-f2@x>'`);
    expect(earlier.status).toBe("ignored");

    expect(results.map((r) => [r.mailbox, r.reader, r.error ?? null, r.folders.map((f) => f.path)])).toEqual([
      [ENQ, "TEST Enq Reader", null, ["Inbox"]],
      [SALES, "TEST Enq Reader", null, ["Inbox", "Inbox/2026", "Enquiries"]],
    ]);
    const queued = await rows<{ kind: string; entity: string; status: string; mailbox: string; message_id: string }>(
      sql`select kind, entity, status, mailbox, message_id from crm.web_enquiries where external_id like '<enqtest-%' order by external_id`,
    );
    expect(queued).toEqual([
      { kind: "form", entity: "AUS", status: "pending", mailbox: SALES, message_id: "s1-moved" }, // one row, the newest id
      { kind: "form", entity: "AUS", status: "pending", mailbox: SALES, message_id: "s2" },
      { kind: "form", entity: "NZ", status: "pending", mailbox: ENQ, message_id: "n1" },
      { kind: "form", entity: "AUS", status: "pending", mailbox: SALES, message_id: "s9" },
      { kind: "shop_order", entity: "AUS", status: "pending", mailbox: SALES, message_id: "s3" },
    ]);
    // Ordinary mail: known contact logged (marked with the shared mailbox); unknown sender to triage.
    const [logged] = await rows<{ mailbox: string; folder: string }>(
      sql`select metadata ->> 'mailbox' as mailbox, metadata ->> 'folder' as folder from crm.activities where contact_id = ${knownId}`,
    );
    expect(logged).toEqual({ mailbox: SALES, folder: "Inbox" });
    const [triage] = await rows<{ mailbox: string }>(sql`select mailbox from crm.unmatched_emails where from_address = 'stranger@new.enqtest.test'`);
    expect(triage.mailbox).toBe(SALES);
    // Notifications never land in triage or on a timeline as plain email.
    expect(await rows(sql`select 1 from crm.unmatched_emails where external_id in ('<enqtest-f1@x>', '<enqtest-o1@x>')`)).toEqual([]);

    const status = await listSharedStatus();
    expect(status.filter((s) => s.mailbox === SALES).map((s) => [s.folder_path, s.catching_up, s.last_error])).toEqual([
      ["Enquiries", false, null],
      ["Inbox", false, null],
      ["Inbox/2026", false, null],
    ]);
  });

  it("turns forms into contacts and New enquiry deals with alternating owners, consent and entity", async () => {
    const g = fakeOutlook({ [SALES]: [{ id: "x", name: "Inbox" }], [ENQ]: [{ id: "y", name: "Inbox" }] }, {
      x: [m("s1-moved", "f1", {}), m("s2", "f2", {}), m("s9", "f4", {}), m("s3", "o1", {})],
      y: [m("n1", "f3", {})],
    });
    const r = await processWebEnquiries({ extract, extractOrder, fetchImpl: g.impl });
    expect(r).toMatchObject({ attempted: 5, created: 4, deals: 2, orders: 1, skipped: 1, failed: 0 });

    const contacts = await rows<{ email: string; first_name: string; phone_e164: string; country_code: string; source: string; consent_status: string; company: string | null; notes: string | null }>(sql`
      select c.email, c.first_name, c.phone_e164, c.country_code, c.source, c.consent_status, co.name as company, c.notes
      from crm.contacts c left join crm.companies co on co.id = c.company_id
      where c.email in ('ann@build.enqtest.test', 'optout@b.enqtest.test', 'old@nz.enqtest.test') order by c.email`);
    expect(contacts).toEqual([
      { email: "ann@build.enqtest.test", first_name: "Ann", phone_e164: "+61412345678", country_code: "AU", source: "form", consent_status: "subscribed", company: "TEST E Build Co", notes: "Website form: Region: NSW; Customer type: Builder" },
      { email: "old@nz.enqtest.test", first_name: "Old", phone_e164: "+64215550101", country_code: "NZ", source: "form", consent_status: "unknown", company: null, notes: null },
      { email: "optout@b.enqtest.test", first_name: "Opt", phone_e164: "+61400000000", country_code: "AU", source: "form", consent_status: "unsubscribed", company: null, notes: null },
    ]);

    const deals = await rows<{ email: string; entity: string; est_currency: string; stage: string; source: string; owner: string; received: boolean }>(sql`
      select c.email, d.entity, d.est_currency, d.stage, d.source, p.email as owner,
             d.created_at = w.received_at as received
      from crm.deals d join crm.contacts c on c.id = d.primary_contact_id join crm.profiles p on p.id = d.owner_id
      join crm.web_enquiries w on w.deal_id = d.id
      where c.email like '%enqtest.test' order by d.created_at, c.email`);
    // AUS forms alternate between Iris and Mark; the 30-day-old NZ form opened no deal.
    expect(deals.map((d) => [d.entity, d.est_currency, d.stage, d.source, d.received])).toEqual([
      ["AUS", "AUD", "new_enquiry", "website_form", true],
      ["AUS", "AUD", "new_enquiry", "website_form", true],
    ]);
    expect(new Set(deals.map((d) => d.owner))).toEqual(new Set(["iris@saveboard.nz", "mark@saveboard.com.au"]));

    const [act] = await rows<{ origin: string; summary: string; form: { products: string[] }; deal: boolean }>(sql`
      select a.origin, a.summary, a.metadata -> 'form' as form, a.deal_id is not null as deal
      from crm.activities a join crm.contacts c on c.id = a.contact_id where c.email = 'ann@build.enqtest.test'`);
    expect(act).toMatchObject({ origin: "form", summary: "Wants pricing on panels.", form: { products: ["Wall panels"] }, deal: true });
    const [old] = await rows<{ deal: boolean }>(sql`
      select a.deal_id is not null as deal from crm.activities a join crm.contacts c on c.id = a.contact_id where c.email = 'old@nz.enqtest.test'`);
    expect(old.deal).toBe(false);

    const [audit] = await rows<{ actor_type: string }>(sql`
      select actor_type from crm.audit_log where table_name = 'contacts'
        and record_id = (select id::text from crm.contacts where email = 'ann@build.enqtest.test') and action = 'INSERT'`);
    expect(audit.actor_type).toBe("claude");
    const [spam] = await rows<{ status: string; error: string }>(sql`select status, error from crm.web_enquiries where external_id = '<enqtest-f4@x>'`);
    expect(spam).toEqual({ status: "skipped", error: "Not a real enquiry (spam or test)" });

    // A shop order: the buyer becomes a contact (NZ from the order), samples sent ticked, logged, no deal.
    const [buyer] = await rows<{ source: string; country_code: string; city: string; samples_sent: boolean; deals: number; order: { number: string; samples: boolean } }>(sql`
      select c.source, c.country_code, c.city, c.samples_sent,
             (select count(*)::int from crm.deals where primary_contact_id = c.id) as deals,
             (select metadata -> 'shop_order' from crm.activities where contact_id = c.id) as order
      from crm.contacts c where c.email = 'sam@shop.enqtest.test'`);
    expect(buyer).toEqual({ source: "shop", country_code: "NZ", city: "Christchurch", samples_sent: true, deals: 0, order: { number: "1042", items: [{ name: "Sample pack", quantity: 2 }], samples: true } });

    // Done is done: nothing is processed twice.
    expect((await processWebEnquiries({ extract, extractOrder, fetchImpl: g.impl })).attempted).toBe(0);
  });
});
