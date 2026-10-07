import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { acceptSuggestion, completeChase, dismissChase, listChase, refreshChaseList, snoozeChase } from "./chase";

// The chase list as crm_app. Own rows: deals 'TEST C ...', owner 'TEST Chaser'.

const SYS = { type: "system" as const, reason: "import" as const };
let ownerId = "";
const user = () => ({ type: "user" as const, profileId: ownerId });
const ids: Record<string, string> = {};

async function cleanup() {
  await withActor(SYS, async (tx) => {
    const mine = sql`(select id from crm.deals where title like 'TEST C %')`;
    await tx.execute(sql`delete from crm.tasks where deal_id in ${mine}`);
    await tx.execute(sql`delete from crm.activities where deal_id in ${mine}`);
    await tx.execute(sql`delete from crm.deals where title like 'TEST C %'`);
    await tx.execute(sql`delete from crm.profiles where display_name = 'TEST Chaser'`);
  });
}

async function deal(title: string, stage: string, createdAgo: string, lastActivityAgo: string | null, extra = sql``) {
  return withActor(SYS, async (tx) => {
    const [d] = await rows<{ id: string }>(
      sql`insert into crm.deals (title, stage, entity, owner_id, created_at)
          values (${title}, ${stage}::crm.deal_stage, 'NZ', ${ownerId}, now() - ${createdAgo}::interval) returning id`,
      tx,
    );
    // Set after insert: the stage trigger stamps stage_changed_at = now() on insert.
    await tx.execute(sql`update crm.deals set stage_changed_at = now() - ${createdAgo}::interval,
                           last_activity_at = ${lastActivityAgo ? sql`now() - ${lastActivityAgo}::interval` : sql`null`} ${extra}
                         where id = ${d.id}`);
    return d.id;
  });
}

const openTasks = (dealId: string) =>
  rows<{ rule: string; status: string; detail: string | null; assigned_to: string }>(
    sql`select rule, status, detail, assigned_to from crm.tasks where deal_id = ${dealId} and status = 'open'`,
  );

beforeAll(async () => {
  await cleanup();
  [{ id: ownerId }] = await withActor(SYS, (tx) =>
    rows<{ id: string }>(sql`insert into crm.profiles (display_name, email) values ('TEST Chaser', 'chaser@saveboard.nz') returning id`, tx),
  );
  ids.fresh = await deal("TEST C fresh enquiry", "new_enquiry", "1 hour", null);
  ids.slow = await deal("TEST C slow enquiry", "new_enquiry", "10 days", null);
  ids.quiet = await deal("TEST C quiet deal", "contacted", "30 days", "10 days");
  ids.busy = await deal("TEST C busy deal", "qualified", "30 days", "1 day");
  ids.unanswered = await deal("TEST C unanswered quote", "quote_sent", "9 days", null);
  ids.expiring = await deal(
    "TEST C expiring quote",
    "quote_sent",
    "2 days",
    null,
    sql`, entity = 'NZ', erp_status = 'quote', erp_quote_status = 'sent', erp_quote_expires_on = (now() at time zone 'Pacific/Auckland')::date + 2`,
  );
});
afterAll(cleanup);

describe("business days", () => {
  it("skips weekends in NZ time", async () => {
    const at = (ts: string) =>
      rows<{ d: string }>(sql`select to_char(crm.business_deadline(${ts}::timestamptz, 1) at time zone 'Pacific/Auckland', 'Dy DD HH24:MI') as d`);
    expect((await at("2026-10-09 15:00 Pacific/Auckland"))[0].d).toBe("Mon 12 15:00"); // Friday afternoon -> Monday
    expect((await at("2026-10-10 11:00 Pacific/Auckland"))[0].d).toBe("Tue 13 08:00"); // Saturday -> clock starts Monday 8am
    expect((await at("2026-10-07 09:30 Pacific/Auckland"))[0].d).toBe("Thu 08 09:30"); // Wednesday -> Thursday
  });
});

describe("chase list", () => {
  it("turns the rules into one task per record, assigned to the owner", async () => {
    await refreshChaseList();
    expect(await openTasks(ids.fresh)).toEqual([]);
    expect(await openTasks(ids.busy)).toEqual([]);
    expect((await openTasks(ids.slow)).map((t) => [t.rule, t.assigned_to])).toEqual([["slow_first_response", ownerId]]);
    expect((await openTasks(ids.quiet)).map((t) => t.rule)).toEqual(["gone_quiet"]);
    expect((await openTasks(ids.unanswered)).map((t) => t.rule)).toEqual(["quote_unanswered"]);
    const [exp] = await openTasks(ids.expiring);
    expect(exp.rule).toBe("quote_expiring");
    expect(exp.detail).toMatch(/^Quote {2}?expires \d\d\/\d\d\/\d{4}$|^Quote .* expires \d\d\/\d\d\/\d{4}$/);

    // Never listed twice.
    const again = await refreshChaseList();
    expect(again.opened).toBe(0);
    expect(await openTasks(ids.quiet)).toHaveLength(1);

    const mine = await listChase({ assignedTo: ownerId });
    expect(mine.map((i) => i.rule)).toEqual(["slow_first_response", "quote_expiring", "quote_unanswered", "gone_quiet"]);
    expect(mine[0]).toMatchObject({ title: "TEST C slow enquiry", entity: "NZ", stage: "new_enquiry" });
  });

  it("any activity clears an item; done logs a note and, for a new enquiry, marks it contacted", async () => {
    // An email (or any activity) on the quiet deal clears its item on the next refresh.
    await withActor(SYS, (tx) =>
      tx.execute(sql`insert into crm.activities (type, direction, summary, occurred_at, deal_id, origin) values ('note', 'internal', 'TEST C', now(), ${ids.quiet}, 'manual')`),
    );
    const r = await refreshChaseList();
    expect(r.closed).toBeGreaterThanOrEqual(1);
    const [cleared] = await rows<{ status: string; closed_reason: string }>(sql`select status, closed_reason from crm.tasks where deal_id = ${ids.quiet}`);
    expect(cleared).toEqual({ status: "done", closed_reason: "cleared" });

    const [slow] = await rows<{ id: string }>(sql`select id from crm.tasks where deal_id = ${ids.slow} and status = 'open'`);
    expect(await completeChase(user(), slow.id, "Rang her, sending samples")).toBe(true);
    const [d] = await rows<{ stage: string }>(sql`select stage from crm.deals where id = ${ids.slow}`);
    expect(d.stage).toBe("contacted");
    const [note] = await rows<{ summary: string; owner_id: string }>(sql`select summary, owner_id from crm.activities where deal_id = ${ids.slow} and type = 'note'`);
    expect(note).toEqual({ summary: "Rang her, sending samples", owner_id: ownerId });
    await refreshChaseList();
    expect(await openTasks(ids.slow)).toEqual([]);

    // Expiring quote: activity since the warning started clears it too.
    const [exp] = await rows<{ id: string }>(sql`select id from crm.tasks where deal_id = ${ids.expiring} and status = 'open'`);
    await completeChase(user(), exp.id, null);
    await refreshChaseList();
    expect(await openTasks(ids.expiring)).toEqual([]);
  });

  it("snoozing takes the record off the list until the date, with the reason kept", async () => {
    const [t] = await rows<{ id: string }>(sql`select id from crm.tasks where deal_id = ${ids.unanswered} and status = 'open'`);
    expect(await dismissChase(user(), t.id)).toBe(false); // rule items are snoozed or done, not dismissed
    expect(await snoozeChase(user(), t.id, "2099-01-01", "Customer on leave")).toBe(true);
    const [d] = await rows<{ snoozed_until: string; snooze_reason: string }>(sql`select snoozed_until, snooze_reason from crm.deals where id = ${ids.unanswered}`);
    expect(d).toEqual({ snoozed_until: "2099-01-01", snooze_reason: "Customer on leave" });
    await refreshChaseList();
    expect(await openTasks(ids.unanswered)).toEqual([]);
  });

  it("a suggestion can be accepted (the deal moves) or dismissed", async () => {
    await withActor(SYS, (tx) =>
      tx.execute(sql`insert into crm.tasks (title, due_on, deal_id, assigned_to, source, rule)
                     values ('Customer replied after the quote: move to Negotiation?', current_date, ${ids.expiring}, ${ownerId}, 'follow_up_engine', 'suggest_negotiation')`),
    );
    await refreshChaseList(); // suggestions are not rule items: a refresh leaves them alone
    const [s] = await rows<{ id: string }>(sql`select id from crm.tasks where deal_id = ${ids.expiring} and rule = 'suggest_negotiation' and status = 'open'`);
    expect(s).toBeDefined();
    expect(await acceptSuggestion(user(), s.id)).toBe(true);
    const [d] = await rows<{ stage: string }>(sql`select stage from crm.deals where id = ${ids.expiring}`);
    expect(d.stage).toBe("negotiation");
  });
});
