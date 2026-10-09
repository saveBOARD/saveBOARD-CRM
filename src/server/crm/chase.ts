import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";

// The chase list (phase 3.5): open tasks from the follow-up rules (crm.refresh_chase_tasks, migration 13), Claude's
// follow-up dates from emails, and suggestions (e.g. "move to Negotiation?"). Done and noted both log a note, which
// is real activity and clears the rule; snoozing sets the record's snooze date and reason.

export type ChaseItem = {
  id: string;
  rule: string;
  source: string;
  priority: number;
  title: string;
  detail: string | null;
  due_on: string;
  assigned_to: string | null;
  assignee: string | null;
  deal_id: string | null;
  contact_id: string | null;
  company_id: string | null;
  contact: string | null;
  company: string | null;
  entity: string | null;
  stage: string | null;
  last_activity_at: string | null;
  created_by_claude: boolean;
  draft_text: string | null;
};

/** Where each kind of item sits on the page, most urgent first. Claude's follow-ups and suggestions slot in. */
export const RULE_ORDER: Record<string, number> = {
  slow_first_response: 1,
  quote_expiring: 2,
  quote_unanswered: 3,
  email_follow_up: 3.5,
  call_follow_up: 3.6,
  visit_follow_up: 4.5,
  gone_quiet: 4,
  specifier_followup: 5,
  existing_customer_checkin: 6,
  suggest_negotiation: 7,
};

/** Open items due today or earlier, for one user or everyone. */
export async function listChase(opts: { assignedTo?: string } = {}): Promise<ChaseItem[]> {
  const items = await rows<ChaseItem>(sql`
    select t.id, t.rule, t.source, coalesce(t.priority, 9) as priority, t.title, t.detail, t.due_on, t.assigned_to,
           p.display_name as assignee, t.deal_id,
           coalesce(t.contact_id, d.primary_contact_id) as contact_id,
           coalesce(t.company_id, d.company_id, ct.company_id) as company_id,
           nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact,
           co.name as company, d.entity, d.stage::text as stage,
           coalesce(d.last_activity_at, ct.last_activity_at, co.last_activity_at) as last_activity_at,
           t.created_by_claude, t.draft_text
    from crm.tasks t
    left join crm.deals d on d.id = t.deal_id
    left join crm.contacts ct on ct.id = coalesce(t.contact_id, d.primary_contact_id)
    left join crm.companies co on co.id = coalesce(t.company_id, d.company_id, ct.company_id)
    left join crm.profiles p on p.id = t.assigned_to
    where t.status = 'open'
      and coalesce(t.due_on, (now() at time zone 'Pacific/Auckland')::date) <= (now() at time zone 'Pacific/Auckland')::date
      and (d.id is null or d.deleted_at is null)
      ${opts.assignedTo ? sql`and t.assigned_to = ${opts.assignedTo}` : sql``}
    order by t.due_on, t.created_at`);
  return items.sort((a, b) => (RULE_ORDER[a.rule] ?? 8) - (RULE_ORDER[b.rule] ?? 8));
}

export async function countUpcoming(assignedTo?: string): Promise<number> {
  const [r] = await rows<{ n: number }>(sql`
    select count(*)::int as n from crm.tasks
    where status = 'open' and due_on > (now() at time zone 'Pacific/Auckland')::date
      ${assignedTo ? sql`and assigned_to = ${assignedTo}` : sql``}`);
  return r?.n ?? 0;
}

export const DISMISSABLE = new Set(["email_follow_up", "call_follow_up", "visit_follow_up", "suggest_negotiation"]);

type Target = { deal_id: string | null; contact_id: string | null; company_id: string | null; rule: string; title: string };

async function target(id: string): Promise<Target | null> {
  const [t] = await rows<Target>(sql`select deal_id, contact_id, company_id, rule, title from crm.tasks where id = ${id} and status = 'open'`);
  return t ?? null;
}

/** Done: logs a note on the record (real activity, so the rule clears) and closes the item. */
export async function completeChase(actor: Actor & { type: "user" }, taskId: string, note: string | null): Promise<boolean> {
  const t = await target(taskId);
  if (!t) return false;
  await withActor(actor, async (tx) => {
    await tx.execute(sql`
      insert into crm.activities (type, direction, summary, occurred_at, deal_id, contact_id, company_id, owner_id, origin, metadata)
      values ('note', 'internal', ${note?.trim() || "Followed up (from the chase list)."}, now(),
              ${t.deal_id}, ${t.contact_id}, ${t.company_id}, ${actor.profileId}, 'manual', ${JSON.stringify({ chase_rule: t.rule })}::jsonb)`);
    // Answering a new enquiry is what "contacted" means.
    if (t.rule === "slow_first_response" && t.deal_id) {
      await tx.execute(sql`update crm.deals set stage = 'contacted' where id = ${t.deal_id} and stage = 'new_enquiry'`);
    }
    await tx.execute(sql`update crm.tasks set status = 'done', closed_reason = 'done', completed_at = now() where id = ${taskId}`);
  });
  return true;
}

/** Snooze: the record drops off the list until the date (the reason is kept on the record), and the item closes. */
export async function snoozeChase(actor: Actor & { type: "user" }, taskId: string, until: string, reason: string): Promise<boolean> {
  const t = await target(taskId);
  if (!t) return false;
  await withActor(actor, async (tx) => {
    if (t.deal_id) await tx.execute(sql`update crm.deals set snoozed_until = ${until}::date, snooze_reason = ${reason} where id = ${t.deal_id}`);
    else if (t.contact_id) await tx.execute(sql`update crm.contacts set snoozed_until = ${until}::date, snooze_reason = ${reason} where id = ${t.contact_id}`);
    else if (t.company_id) await tx.execute(sql`update crm.companies set snoozed_until = ${until}::date, snooze_reason = ${reason} where id = ${t.company_id}`);
    // Claude's follow-ups and suggestions are tasks in their own right: move the task instead.
    if (t.rule === "email_follow_up" || t.rule === "call_follow_up" || t.rule === "visit_follow_up") await tx.execute(sql`update crm.tasks set due_on = ${until}::date where id = ${taskId}`);
    else await tx.execute(sql`update crm.tasks set status = 'snoozed', closed_reason = 'snoozed', completed_at = now() where id = ${taskId}`);
  });
  return true;
}

/** A suggestion accepted: do it (move the deal to Negotiation) and close it. */
export async function acceptSuggestion(actor: Actor & { type: "user" }, taskId: string): Promise<boolean> {
  const t = await target(taskId);
  if (!t || t.rule !== "suggest_negotiation" || !t.deal_id) return false;
  await withActor(actor, async (tx) => {
    await tx.execute(sql`update crm.deals set stage = 'negotiation' where id = ${t.deal_id} and stage = 'quote_sent'`);
    await tx.execute(sql`update crm.tasks set status = 'done', closed_reason = 'accepted', completed_at = now() where id = ${taskId}`);
  });
  return true;
}

/** Dismiss Claude's follow-ups and suggestions. Rule items can't be dismissed (they'd come straight back): snooze them. */
export async function dismissChase(actor: Actor & { type: "user" }, taskId: string): Promise<boolean> {
  const t = await target(taskId);
  if (!t || !DISMISSABLE.has(t.rule)) return false;
  await withActor(actor, (tx) =>
    tx.execute(sql`update crm.tasks set status = 'dismissed', closed_reason = 'dismissed', completed_at = now() where id = ${taskId}`),
  );
  return true;
}

/** Refresh the ERP quote mirror, then turn the rules into tasks. Runs on the 10-minute job. */
export async function refreshChaseList(): Promise<{ erpUpdated: number; opened: number; closed: number }> {
  return withActor({ type: "system", reason: "follow_up" }, async (tx) => {
    const [m] = await rows<{ n: number }>(sql`select crm.refresh_deal_erp_mirror() as n`, tx);
    const [r] = await rows<{ opened: number; closed: number }>(sql`select * from crm.refresh_chase_tasks()`, tx);
    return { erpUpdated: m?.n ?? 0, opened: r?.opened ?? 0, closed: r?.closed ?? 0 };
  });
}
