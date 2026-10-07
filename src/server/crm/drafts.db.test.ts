import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import type { DraftContext, Drafter } from "@/server/claude/draft";
import { saveMailAccount } from "@/server/mail/accounts";
import { forgetGraphToken } from "@/server/mail/graph";
import { draftChase, parseDraft, saveChaseDraft } from "./drafts";

// Chase drafts as crm_app, with a fake Claude and a fake Outlook. Own rows: 'TEST D ...', *.drafttest.test.

const SYS = { type: "system" as const, reason: "import" as const };
let userId = "";
let contactId = "";
let dealId = "";
let taskId = "";
const me = () => ({ id: userId, displayName: "Test Drafter", email: "drafter@saveboard.nz" });

async function cleanup() {
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`delete from crm.tasks where title like 'TEST D %'`);
    await tx.execute(sql`delete from crm.activities where subject like 'TEST D %'`);
    await tx.execute(sql`delete from crm.deals where title like 'TEST D %'`);
    await tx.execute(sql`delete from crm.contacts where email like '%drafttest.test'`);
    await tx.execute(sql`delete from crm.profiles where display_name = 'TEST Drafter'`);
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
    [{ id: userId }] = await rows<{ id: string }>(sql`insert into crm.profiles (display_name, email) values ('TEST Drafter', 'drafter@saveboard.nz') returning id`, tx);
    [{ id: contactId }] = await rows<{ id: string }>(
      sql`insert into crm.contacts (first_name, last_name, email) values ('Sarah', 'Jones', 'sarah@a.drafttest.test') returning id`,
      tx,
    );
    [{ id: dealId }] = await rows<{ id: string }>(
      sql`insert into crm.deals (title, stage, entity, primary_contact_id, owner_id, erp_so_number, erp_status, erp_quote_status, erp_quote_expires_on)
          values ('TEST D Smith St job', 'quote_sent', 'NZ', ${contactId}, ${userId}, 'Q-1042', 'quote', 'sent', '2026-10-20') returning id`,
      tx,
    );
    await tx.execute(sql`insert into crm.activities (type, direction, subject, summary, occurred_at, deal_id, contact_id, origin)
                         values ('email', 'outbound', 'TEST D quote', 'Sent quote Q-1042 for 40 wall panels.', now() - interval '9 days', ${dealId}, ${contactId}, 'graph')`);
    [{ id: taskId }] = await rows<{ id: string }>(
      sql`insert into crm.tasks (title, detail, due_on, deal_id, assigned_to, source, rule)
          values ('TEST D Smith St job', 'Quote Q-1042 sent with no activity since', current_date, ${dealId}, ${userId}, 'follow_up_engine', 'quote_unanswered') returning id`,
      tx,
    );
  });
  await saveMailAccount({ type: "user", profileId: userId }, userId, "drafter@saveboard.nz", "refresh-1", "Mail.ReadWrite");
  forgetGraphToken(userId);
});
afterAll(async () => {
  await cleanup();
  vi.unstubAllEnvs();
});

const setConsent = (status: string) => withActor(SYS, (tx) => tx.execute(sql`update crm.contacts set consent_status = ${status}::crm.consent_status where id = ${contactId}`));

describe("chase drafts", () => {
  it("gives Claude the deal, the quote and recent summaries, and keeps the draft on the item", async () => {
    let seen: DraftContext | null = null;
    const drafter: Drafter = async (ctx) => {
      seen = ctx;
      return { subject: "Re: Smith St quote", body: "Hi Sarah,\n\nDid the quote for the 40 panels work for you?\n\nTest" };
    };
    const r = await draftChase(me(), taskId, drafter);
    expect(r).toMatchObject({ ok: true, warning: null, draft: { subject: "Re: Smith St quote", to: "sarah@a.drafttest.test" } });
    expect(seen).toMatchObject({
      reason: "TEST D Smith St job: Quote Q-1042 sent with no activity since",
      sender: { name: "Test Drafter", email: "drafter@saveboard.nz" },
      contact: { first_name: "Sarah", name: "Sarah Jones" },
      deal: { title: "TEST D Smith St job", stage: "Quote sent", entity: "NZ", quote_number: "Q-1042", quote_status: "sent", quote_expires_on: "20/10/2026" },
      recent: [{ direction: "outbound", type: "email", subject: "TEST D quote", summary: "Sent quote Q-1042 for 40 wall panels." }],
    });
    const [t] = await rows<{ draft_text: string }>(sql`select draft_text from crm.tasks where id = ${taskId}`);
    expect(parseDraft(t.draft_text)).toMatchObject({ subject: "Re: Smith St quote", model: "claude-opus-5-5" });
  });

  it("warns for unsubscribed contacts, and never drafts to a bounced address", async () => {
    const drafter = vi.fn<Drafter>(async () => ({ subject: "s", body: "b" }));
    await setConsent("unsubscribed");
    expect(await draftChase(me(), taskId, drafter)).toMatchObject({ ok: true, warning: expect.stringMatching(/unsubscribed from marketing/) });
    await setConsent("bounced");
    expect(await draftChase(me(), taskId, drafter)).toMatchObject({ ok: false, message: expect.stringMatching(/bounced/) });
    expect(drafter).toHaveBeenCalledTimes(1);
    expect(await saveChaseDraft({ type: "user", profileId: userId }, taskId, { subject: "s", body: "b" })).toMatchObject({ ok: false });
    await setConsent("unknown");
  });

  it("saves to the user's Outlook Drafts (never sends), and a second save updates the same draft", async () => {
    const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
    let patchStatus = 200;
    const fake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("login.microsoftonline.com")) return json({ access_token: "acc", expires_in: 3600 });
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (init?.method === "PATCH") return patchStatus === 200 ? json({ id: "draft-1", webLink: "https://outlook/d1", isDraft: true }) : json({ error: { code: "ErrorItemNotFound" } }, 404);
      return json({ id: `draft-${calls.length}`, webLink: `https://outlook/d${calls.length}`, isDraft: true });
    }) as unknown as typeof fetch;

    const first = await saveChaseDraft({ type: "user", profileId: userId }, taskId, { subject: "Re: Smith St quote", body: "Hi Sarah" }, fake);
    expect(first).toEqual({ ok: true, link: "https://outlook/d1" });
    expect(calls[0]).toEqual({
      method: "POST",
      url: "https://graph.microsoft.com/v1.0/me/messages",
      body: { subject: "Re: Smith St quote", body: { contentType: "Text", content: "Hi Sarah" }, toRecipients: [{ emailAddress: { address: "sarah@a.drafttest.test", name: "Sarah Jones" } }] },
    });

    await saveChaseDraft({ type: "user", profileId: userId }, taskId, { subject: "Re: Smith St quote", body: "Hi Sarah, edited" }, fake);
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "https://graph.microsoft.com/v1.0/me/messages/draft-1" });

    // Deleted (or sent) in Outlook since: a new draft is made instead.
    patchStatus = 404;
    await saveChaseDraft({ type: "user", profileId: userId }, taskId, { subject: "Re: Smith St quote", body: "Third" }, fake);
    expect(calls.slice(2).map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(calls.every((c) => !/\/send|\/reply|\/forward/i.test(c.url))).toBe(true);
    const [t] = await rows<{ draft_text: string }>(sql`select draft_text from crm.tasks where id = ${taskId}`);
    expect(parseDraft(t.draft_text)).toMatchObject({ body: "Third", outlook_id: "draft-4", outlook_link: "https://outlook/d4" });
  });
});
