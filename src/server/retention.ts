import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";

// Retention (phase 3.8, approved 7 Oct 2026): captured email and call notes are personal information (NZ Privacy Act
// 2020, Australian Privacy Act), so they are kept for `retention_months` (24, a setting) and then deleted, nightly.
//   Deleted when older:  email activities captured from Outlook, website forms and shop orders; call notes from voice
//                        recordings (and the recordings' transcripts); Inbox triage items; the website enquiry queue;
//                        Claude's chase drafts on closed tasks.
//   Kept:                notes people typed, HubSpot history, system events, and the contacts, companies and deals.
// Deletes run in small batches so no single statement comes near the 30-second limit (migration 11).

const BATCH = 2_000;
const SYS = { type: "system" as const, reason: "import" as const };

export type RetentionRun = { months: number; cutoff: string; deleted: Record<string, number>; finished: boolean };

async function inBatches(deadline: number, step: () => Promise<number>): Promise<{ n: number; done: boolean }> {
  let n = 0;
  while (Date.now() < deadline) {
    const k = await step();
    n += k;
    if (k < BATCH) return { n, done: true };
  }
  return { n, done: false };
}

export async function runRetention(opts: { budgetMs?: number; now?: Date } = {}): Promise<RetentionRun> {
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  // The setting exists from the first run on, so it can be changed in crm.settings like the other thresholds.
  await withActor(SYS, (tx) =>
    tx.execute(sql`insert into crm.settings (key, value, note)
                   values ('retention_months', '24', 'Captured email and call notes older than this many months are deleted nightly')
                   on conflict (key) do nothing`),
  );
  const [s] = await rows<{ months: number }>(sql`select greatest(coalesce(crm.setting_int('retention_months'), 24), 1) as months`);
  const now = opts.now ?? new Date();
  const [c] = await rows<{ cutoff: string }>(sql`select (${now.toISOString()}::timestamptz - make_interval(months => ${s.months}))::text as cutoff`);
  const cutoff = c.cutoff;

  const del = (q: ReturnType<typeof sql>) => () =>
    withActor(SYS, async (tx) => (await rows<{ id: string }>(q, tx)).length);

  const steps: [string, () => Promise<number>][] = [
    [
      "emails",
      del(sql`delete from crm.activities where id in (
                select id from crm.activities
                where type = 'email' and origin in ('graph', 'form') and occurred_at < ${cutoff}::timestamptz
                limit ${BATCH}) returning id`),
    ],
    [
      "call_notes",
      del(sql`delete from crm.activities where id in (
                select id from crm.activities
                where origin = 'voice' and occurred_at < ${cutoff}::timestamptz
                limit ${BATCH}) returning id`),
    ],
    [
      "voice_notes",
      del(sql`delete from crm.voice_notes where id in (
                select id from crm.voice_notes where created_at < ${cutoff}::timestamptz limit ${BATCH}) returning id`),
    ],
    [
      "triage",
      del(sql`delete from crm.unmatched_emails where id in (
                select id from crm.unmatched_emails where coalesce(received_at, created_at) < ${cutoff}::timestamptz limit ${BATCH}) returning id`),
    ],
    [
      "enquiry_queue",
      del(sql`delete from crm.web_enquiries where id in (
                select id from crm.web_enquiries where received_at < ${cutoff}::timestamptz and status <> 'pending' limit ${BATCH}) returning id`),
    ],
    [
      "drafts",
      del(sql`update crm.tasks set draft_text = null where id in (
                select id from crm.tasks
                where draft_text is not null and status <> 'open' and coalesce(completed_at, updated_at) < ${cutoff}::timestamptz
                limit ${BATCH}) returning id`),
    ],
  ];

  const deleted: Record<string, number> = {};
  let finished = true;
  for (const [name, step] of steps) {
    if (Date.now() >= deadline) {
      finished = false;
      break;
    }
    const r = await inBatches(deadline, step);
    deleted[name] = r.n;
    if (!r.done) finished = false;
  }

  const result: RetentionRun = { months: s.months, cutoff, deleted, finished };
  await withActor(SYS, (tx) =>
    tx.execute(sql`insert into crm.settings (key, value, note) values ('retention_last_run', ${JSON.stringify({ at: now.toISOString(), ...result })}, 'Last nightly retention run')
                   on conflict (key) do update set value = excluded.value, updated_at = now()`),
  );
  return result;
}

export async function lastRetentionRun(): Promise<(RetentionRun & { at: string }) | null> {
  const [r] = await rows<{ value: string }>(sql`select value from crm.settings where key = 'retention_last_run'`);
  try {
    return r ? (JSON.parse(r.value) as RetentionRun & { at: string }) : null;
  } catch {
    return null;
  }
}
