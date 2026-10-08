import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { lastRetentionRun, runRetention } from "./retention";

// Retention as crm_app. Own rows: subjects/summaries 'TEST R ...', '<rettest-...>'. "Now" is set in the test, so the
// cutoff (24 months before it) falls between the old and the new rows.

const SYS = { type: "system" as const, reason: "import" as const };
const NOW = new Date("2026-10-09T00:00:00Z");
const OLD = "2024-09-01T00:00:00Z"; // older than 24 months
const NEW = "2025-11-01T00:00:00Z"; // within 24 months
let contactId = "";

async function cleanup() {
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`delete from crm.activities where subject like 'TEST R %' or summary like 'TEST R %'`);
    await tx.execute(sql`delete from crm.unmatched_emails where external_id like '<rettest-%'`);
    await tx.execute(sql`delete from crm.web_enquiries where external_id like '<rettest-%'`);
    await tx.execute(sql`delete from crm.tasks where title like 'TEST R %'`);
    await tx.execute(sql`delete from crm.contacts where email = 'r@rettest.test'`);
  });
}

beforeAll(async () => {
  await cleanup();
  await withActor(SYS, async (tx) => {
    [{ id: contactId }] = await rows<{ id: string }>(sql`insert into crm.contacts (first_name, email) values ('R', 'r@rettest.test') returning id`, tx);
    const act = (type: string, origin: string, at: string, label: string) =>
      tx.execute(sql`insert into crm.activities (type, direction, subject, summary, occurred_at, contact_id, origin)
                     values (${type}::crm.activity_type, 'inbound', ${`TEST R ${label}`}, ${`TEST R ${label}`}, ${at}::timestamptz, ${contactId}, ${origin}::crm.activity_origin)`);
    await act("email", "graph", OLD, "old outlook email");
    await act("email", "form", OLD, "old website form");
    await act("call", "voice", OLD, "old call note");
    await act("note", "manual", OLD, "old typed note");
    await act("note", "hubspot", OLD, "old hubspot note");
    await act("email", "graph", NEW, "recent outlook email");
    await tx.execute(sql`insert into crm.unmatched_emails (external_id, from_address, subject, received_at) values ('<rettest-1>', 'x@rettest.test', 'TEST R', ${OLD})`);
    await tx.execute(sql`insert into crm.web_enquiries (kind, mailbox, entity, external_id, received_at, status) values ('form', 'sales@saveboard.com.au', 'AUS', '<rettest-2>', ${OLD}, 'done')`);
    await tx.execute(sql`insert into crm.tasks (title, status, draft_text, completed_at, source) values ('TEST R closed with draft', 'done', '{"subject":"s","body":"b"}', ${OLD}, 'claude')`);
    await tx.execute(sql`insert into crm.tasks (title, status, draft_text, source) values ('TEST R open with draft', 'open', '{"subject":"s","body":"b"}', 'claude')`);
  });
});
afterAll(cleanup);

describe("retention", () => {
  it("deletes captured email and call notes older than 24 months, and keeps typed notes and HubSpot history", async () => {
    const r = await runRetention({ now: NOW });
    expect(r.months).toBe(24);
    expect(r.finished).toBe(true);

    const left = await rows<{ subject: string }>(sql`select subject from crm.activities where contact_id = ${contactId} order by subject`);
    expect(left.map((a) => a.subject)).toEqual(["TEST R old hubspot note", "TEST R old typed note", "TEST R recent outlook email"]);
    expect(await rows(sql`select 1 from crm.unmatched_emails where external_id = '<rettest-1>'`)).toEqual([]);
    expect(await rows(sql`select 1 from crm.web_enquiries where external_id = '<rettest-2>'`)).toEqual([]);
    const tasks = await rows<{ title: string; has_draft: boolean }>(sql`select title, draft_text is not null as has_draft from crm.tasks where title like 'TEST R %' order by title`);
    expect(tasks).toEqual([
      { title: "TEST R closed with draft", has_draft: false },
      { title: "TEST R open with draft", has_draft: true },
    ]);

    const last = await lastRetentionRun();
    expect(last).toMatchObject({ months: 24, finished: true, at: NOW.toISOString() });
    expect(last!.deleted.emails).toBeGreaterThanOrEqual(2);
  });

  it("follows the setting", async () => {
    await withActor(SYS, (tx) => tx.execute(sql`update crm.settings set value = '6' where key = 'retention_months'`));
    try {
      await runRetention({ now: NOW });
      expect(await rows(sql`select 1 from crm.activities where subject = 'TEST R recent outlook email'`)).toEqual([]);
    } finally {
      await withActor(SYS, (tx) => tx.execute(sql`update crm.settings set value = '24' where key = 'retention_months'`));
    }
  });
});
