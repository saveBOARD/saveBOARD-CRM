import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import type { CallNote, CallNoteReader } from "@/server/claude/call-note";
import { confirmCallNote, createCallNote, discardCallNote, getCallNote, listWaitingNotes, openDealsFor, suggestContacts } from "./calls";
import { listChase } from "./chase";

// Call notes as crm_app, with a fake Claude. Own rows: 'TEST K ...', *.calltest.test.

const SYS = { type: "system" as const, reason: "import" as const };
let userId = "";
let sarahId = "";
let dealId = "";
const me = () => ({ id: userId, displayName: "TEST K Caller" });
const actor = () => ({ type: "user" as const, profileId: userId });

async function cleanup() {
  await withActor(SYS, async (tx) => {
    const mine = sql`(select id from crm.contacts where email like '%calltest.test' or last_name = 'Kowhai')`;
    await tx.execute(sql`delete from crm.tasks where contact_id in ${mine} or deal_id in (select id from crm.deals where title like 'TEST K %')`);
    await tx.execute(sql`delete from crm.activities where contact_id in ${mine}`);
    await tx.execute(sql`delete from crm.voice_notes where owner_id in (select id from crm.profiles where display_name = 'TEST K Caller')`);
    await tx.execute(sql`delete from crm.deals where title like 'TEST K %'`);
    await tx.execute(sql`delete from crm.contacts where email like '%calltest.test' or last_name = 'Kowhai'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST K %'`);
    await tx.execute(sql`delete from crm.profiles where display_name = 'TEST K Caller'`);
  });
}

beforeAll(async () => {
  await cleanup();
  await withActor(SYS, async (tx) => {
    [{ id: userId }] = await rows<{ id: string }>(sql`insert into crm.profiles (display_name, email) values ('TEST K Caller', 'caller@saveboard.nz') returning id`, tx);
    const [co] = await rows<{ id: string }>(sql`insert into crm.companies (name) values ('TEST K Smith Builders') returning id`, tx);
    [{ id: sarahId }] = await rows<{ id: string }>(
      sql`insert into crm.contacts (first_name, last_name, email, phone_raw, phone_e164, company_id)
          values ('Sarah', 'Jones', 'sarah@smith.calltest.test', '021 555 0199', '+6421550199', ${co.id}) returning id`,
      tx,
    );
    [{ id: dealId }] = await rows<{ id: string }>(
      sql`insert into crm.deals (title, stage, entity, primary_contact_id, company_id, owner_id)
          values ('TEST K Riverside job', 'quote_sent', 'NZ', ${sarahId}, ${co.id}, ${userId}) returning id`,
      tx,
    );
  });
});
afterAll(cleanup);

const reading = (o: Partial<CallNote>): CallNote => ({
  person_name: "Sarah Jones",
  company_name: "Smith Builders",
  phone: null,
  email: null,
  summary: "Sarah accepted the Riverside quote and wants delivery in two weeks.",
  next_step: "Book delivery",
  follow_up_date: "2099-12-01",
  new_enquiry: false,
  stage_hint: "won",
  ...o,
});

describe("call notes", () => {
  it("keeps the note, has Claude read it, and suggests the right contact and deal", async () => {
    let seen: Parameters<CallNoteReader>[0] | null = null;
    const id = await createCallNote(me(), { note: "spoke to sarah jones at smith builders, theyve accepted the quote" }, async (i) => {
      seen = i;
      return reading({});
    });
    expect(seen).toMatchObject({ caller: "TEST K Caller", knownContact: null });
    const n = await getCallNote(id, userId);
    expect(n).toMatchObject({ status: "summarised", note: "spoke to sarah jones at smith builders, theyve accepted the quote", extracted: { stage_hint: "won" } });
    expect(await getCallNote(id, "00000000-0000-4000-8000-000000000000")).toBeNull(); // only the person who logged it

    const cands = await suggestContacts(n!.extracted, null);
    expect(cands[0]).toMatchObject({ id: sarahId, name: "Sarah Jones", company: "TEST K Smith Builders", reason: "Name in the note" });
    expect((await openDealsFor(sarahId)).map((d) => d.id)).toEqual([dealId]);
    expect((await listWaitingNotes(userId)).map((w) => w.id)).toContain(id);
  });

  it("finds the contact by a phone number said in the note", async () => {
    const cands = await suggestContacts(reading({ person_name: null, company_name: null, phone: "021 550 199" }), null);
    expect(cands.map((c) => c.id)).toContain(sarahId);
  });

  it("confirm: the call goes on the timeline, the follow-up becomes a chase item, and the stage moves only when ticked", async () => {
    const id = await createCallNote(me(), { note: "sarah accepted the quote", contactId: sarahId, dealId }, async () => reading({ follow_up_date: "2026-01-01" }));
    await confirmCallNote(actor(), id, {
      summary: "Sarah accepted the Riverside quote.",
      contact: { id: sarahId },
      deal: { id: dealId },
      nextStep: "Book delivery",
      followUpOn: "2026-01-01",
      stage: "won",
    });
    const [act] = await rows<{ type: string; origin: string; summary: string; deal_id: string; owner_id: string }>(
      sql`select type, origin, summary, deal_id, owner_id from crm.activities where contact_id = ${sarahId} and origin = 'voice'`,
    );
    expect(act).toEqual({ type: "call", origin: "voice", summary: "Sarah accepted the Riverside quote.", deal_id: dealId, owner_id: userId });
    const [d] = await rows<{ stage: string }>(sql`select stage from crm.deals where id = ${dealId}`);
    expect(d.stage).toBe("won");
    const due = await listChase({ assignedTo: userId });
    expect(due.find((i) => i.rule === "call_follow_up")).toMatchObject({ title: "Book delivery", deal_id: dealId, created_by_claude: true });
    await expect(confirmCallNote(actor(), id, { summary: "again", contact: { id: sarahId }, deal: null, nextStep: null, followUpOn: null, stage: null })).rejects.toThrow(/already/);
  });

  it("someone new: creates the contact (and company) and a new deal, only on confirm", async () => {
    const id = await createCallNote(me(), { note: "new lead aroha kowhai from tui homes" }, async () =>
      reading({ person_name: "Aroha Kowhai", company_name: "TEST K Tui Homes", stage_hint: null, new_enquiry: true }),
    );
    expect(await rows(sql`select 1 from crm.contacts where last_name = 'Kowhai'`)).toEqual([]);
    const r = await confirmCallNote(actor(), id, {
      summary: "New lead for a 12-house development.",
      contact: { new: { first_name: "Aroha", last_name: "Kowhai", company: "TEST K Tui Homes", phone: "021 444 1234", email: null } },
      deal: { new: { title: "TEST K Tui Homes subdivision", entity: "NZ" } },
      nextStep: null,
      followUpOn: null,
      stage: null,
    });
    const [c] = await rows<{ company: string; owner_id: string; phone_e164: string | null }>(sql`
      select co.name as company, c.owner_id, c.phone_e164 from crm.contacts c join crm.companies co on co.id = c.company_id where c.id = ${r.contactId}`);
    expect(c).toMatchObject({ company: "TEST K Tui Homes", owner_id: userId });
    const [deal] = await rows<{ entity: string; est_currency: string; stage: string; source: string }>(sql`select entity, est_currency, stage, source from crm.deals where id = ${r.dealId}`);
    expect(deal).toEqual({ entity: "NZ", est_currency: "NZD", stage: "contacted", source: "phone" });
  });

  it("discard removes the note's text straight away", async () => {
    const id = await createCallNote(me(), { note: "wrong person, ignore" }, null);
    await discardCallNote(actor(), id);
    expect(await getCallNote(id, userId)).toMatchObject({ status: "discarded", note: null, extracted: null });
  });
});
