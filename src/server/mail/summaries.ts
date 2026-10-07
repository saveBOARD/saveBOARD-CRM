import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { claudeConfigured, summariseWithClaude, type Summariser } from "@/server/claude/summarise";
import { toLocalDate } from "@/lib/format";
import { MailNotConnected } from "./graph";
import { addressOf, fetchMessageText, messageText, type MessageText } from "./text";

// Claude summaries for logged emails (phase 3.3). For each email logged by the sync and not yet summarised: fetch its
// text from Outlook, have Claude summarise it, store ONLY the summary, next step and follow-up date (never the text),
// and turn a follow-up date into a task. One email logged on two contacts is summarised once.

const MAX_ATTEMPTS = 3;
const CONCURRENCY = 4;

type Pending = {
  key: string;
  owner_id: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  occurred_at: string;
  mailbox: string | null;
  message_id: string | null;
  attempts: number;
  contact_id: string | null;
  deal_id: string | null;
  assignee: string | null;
};

export type SummaryRun = { attempted: number; summarised: number; tasks: number; refused: number; failed: number; skipped?: string };

async function pending(limit: number, ownerId?: string): Promise<Pending[]> {
  return rows<Pending>(sql`
    with todo as (
      select split_part(a.external_id, '|', 1) as key, a.*
      from crm.activities a
      where a.origin = 'graph' and a.type = 'email' and a.summary is null and a.external_id is not null
        and coalesce(a.metadata ->> 'summary_status', '') = ''
        and coalesce((a.metadata ->> 'summary_attempts')::int, 0) < ${MAX_ATTEMPTS}
        ${ownerId ? sql`and a.owner_id = ${ownerId}` : sql``}
    )
    select * from (
    select distinct on (t.key) t.key, t.owner_id, t.direction, t.subject, t.occurred_at,
           t.metadata ->> 'mailbox' as mailbox, t.metadata ->> 'message_id' as message_id,
           coalesce((t.metadata ->> 'summary_attempts')::int, 0) as attempts,
           t.contact_id, t.deal_id,
           coalesce(d.owner_id, c.owner_id, t.owner_id) as assignee
    from todo t
    left join crm.deals d on d.id = t.deal_id
    left join crm.contacts c on c.id = t.contact_id
    join crm.mail_accounts m on m.profile_id = t.owner_id and m.status = 'connected'
    order by t.key, t.deal_id nulls last, t.occurred_at desc
    ) one_per_email
    -- Newest first: what people are looking at today gets its summary first; the back-fill follows.
    order by occurred_at desc
    limit ${limit}`);
}

async function mark(key: string, patch: Record<string, unknown>, summary?: string) {
  await withActor({ type: "claude" }, (tx) =>
    tx.execute(sql`
      update crm.activities
         set metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
             ${summary !== undefined ? sql`, summary = ${summary}` : sql``}
       where origin = 'graph' and split_part(external_id, '|', 1) = ${key} and summary is null`),
  );
}

async function summariseOne(p: Pending, summarise: Summariser, today: string, fetchImpl?: typeof fetch): Promise<"done" | "task" | "refused" | "failed"> {
  let message: MessageText | null;
  try {
    message = await fetchMessageText(p.owner_id, p.mailbox ?? "", p.message_id, p.key, fetchImpl);
  } catch (e) {
    if (e instanceof MailNotConnected) throw e;
    await mark(p.key, { summary_attempts: p.attempts + 1, summary_error: e instanceof Error ? e.message.slice(0, 200) : "fetch failed" });
    return "failed";
  }
  if (!message) {
    // Deleted in Outlook before we got to it: nothing to summarise.
    await mark(p.key, { summary_status: "gone" });
    return "failed";
  }
  const text = messageText(message);
  try {
    const r = await summarise({
      direction: p.direction,
      sentAt: new Date(p.occurred_at).toISOString(),
      from: addressOf(message.from),
      to: [...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])].map(addressOf).filter((a): a is string => !!a),
      subject: p.subject,
      text: text || "(no text)",
      today,
    });
    if ("refused" in r) {
      await mark(p.key, { summary_status: "refused" });
      return "refused";
    }
    const followUp = r.follow_up_date && /^\d{4}-\d{2}-\d{2}$/.test(r.follow_up_date) ? r.follow_up_date : null;
    const summary = r.summary.trim().slice(0, 1000);
    const nextStep = r.next_step?.trim().slice(0, 300) || null;

    // Claude's writes: the summary on the email activity, and a task when it found a follow-up date ahead.
    const makeTask = !!followUp && followUp >= today && followUp <= addDays(today, 366) && (p.deal_id || p.contact_id);
    await withActor({ type: "claude", profileId: p.owner_id }, async (tx) => {
      await tx.execute(sql`
        update crm.activities
           set summary = ${summary},
               metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({ summary_status: "done", next_step: nextStep, follow_up_on: followUp })}::jsonb
         where origin = 'graph' and split_part(external_id, '|', 1) = ${p.key} and summary is null`);
      if (makeTask) {
        await tx.execute(sql`
          insert into crm.tasks (title, due_on, deal_id, contact_id, assigned_to, source, rule, created_by_claude)
          values (${(nextStep ?? `Follow up: ${p.subject ?? "email"}`).slice(0, 200)}, ${followUp}::date, ${p.deal_id}, ${p.contact_id},
                  ${p.assignee}, 'claude', 'email_follow_up', true)`);
      }
    });
    return makeTask ? "task" : "done";
  } catch (e) {
    await mark(p.key, { summary_attempts: p.attempts + 1, summary_error: e instanceof Error ? e.message.slice(0, 200) : "summary failed" });
    return "failed";
  }
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Summarise waiting emails, newest first, until the time budget runs out. */
export async function runSummaries(
  opts: { budgetMs?: number; ownerId?: string; summarise?: Summariser; fetchImpl?: typeof fetch; limit?: number } = {},
): Promise<SummaryRun> {
  const result: SummaryRun = { attempted: 0, summarised: 0, tasks: 0, refused: 0, failed: 0 };
  const summarise = opts.summarise ?? (claudeConfigured() ? summariseWithClaude : null);
  if (!summarise) return { ...result, skipped: "ANTHROPIC_API_KEY is not set" };

  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const queue = await pending(opts.limit ?? 60, opts.ownerId);
  const today = toLocalDate(new Date())!;
  const disconnected = new Set<string>();

  async function worker() {
    for (let p = queue.shift(); p; p = queue.shift()) {
      if (Date.now() > deadline - 8_000) return; // leave time to finish the call in flight
      if (disconnected.has(p.owner_id)) continue;
      result.attempted++;
      try {
        const r = await summariseOne(p, summarise!, today, opts.fetchImpl);
        if (r === "done" || r === "task") result.summarised++;
        if (r === "task") result.tasks++;
        if (r === "refused") result.refused++;
        if (r === "failed") result.failed++;
      } catch (e) {
        if (e instanceof MailNotConnected) disconnected.add(p.owner_id);
        result.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}

export type SummaryStatus = { waiting: number; done: number; refused: number; failed: number; last_error: string | null };

export async function summaryStatus(): Promise<SummaryStatus> {
  const [r] = await rows<SummaryStatus>(sql`
    select count(*) filter (where summary is null and coalesce(metadata ->> 'summary_status', '') = ''
                              and coalesce((metadata ->> 'summary_attempts')::int, 0) < ${MAX_ATTEMPTS})::int as waiting,
           count(*) filter (where metadata ->> 'summary_status' = 'done')::int as done,
           count(*) filter (where metadata ->> 'summary_status' = 'refused')::int as refused,
           count(*) filter (where summary is null and coalesce((metadata ->> 'summary_attempts')::int, 0) >= ${MAX_ATTEMPTS})::int as failed,
           (array_agg(metadata ->> 'summary_error' order by created_at desc) filter (where metadata ? 'summary_error'))[1] as last_error
    from crm.activities
    where origin = 'graph' and type = 'email'`);
  return r;
}
