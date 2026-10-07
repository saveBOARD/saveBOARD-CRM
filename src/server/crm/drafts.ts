import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { claudeConfigured } from "@/server/claude/summarise";
import { draftWithClaude, DRAFT_MODEL, type DraftContext, type Drafter } from "@/server/claude/draft";
import { createOutlookDraft } from "@/server/mail/graph";
import { formatDate, toLocalDate } from "@/lib/format";
import { STAGES, type Stage } from "@/lib/labels";

// Chase drafts (phase 3.6): Claude drafts a follow-up for a chase item; the user reviews it on the Today page and
// saves it to their own Outlook Drafts with one click, then edits and sends it from Outlook. Consent (approved
// plan, question 9): never a draft to a bounced address; a warning (but allowed) for contacts who unsubscribed from
// marketing, since this is one-to-one follow-up on their own enquiry.

export type DraftRecipient = { contactId: string; address: string; name: string | null; consent: string };
export type StoredDraft = {
  subject: string;
  body: string;
  to: string;
  model: string;
  drafted_at: string;
  saved_at?: string;
  outlook_id?: string;
  outlook_link?: string;
};
export type DraftResult =
  | { ok: true; draft: StoredDraft; warning: string | null }
  | { ok: false; message: string };

type Item = {
  rule: string;
  title: string;
  detail: string | null;
  deal_id: string | null;
  contact_id: string | null;
  company_id: string | null;
  draft_text: string | null;
};

async function loadItem(taskId: string): Promise<Item | null> {
  const [t] = await rows<Item>(sql`select rule, title, detail, deal_id, contact_id, company_id, draft_text from crm.tasks where id = ${taskId} and status = 'open'`);
  return t ?? null;
}

/** Who the email goes to: the deal's contact, the contact itself, or the company's most recently active contact. */
async function recipient(t: Item): Promise<DraftRecipient | null> {
  const [r] = await rows<{ id: string; email: string | null; name: string | null; consent: string }>(sql`
    select c.id, c.email, nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '') as name, c.consent_status::text as consent
    from crm.contacts c
    where c.deleted_at is null and c.email is not null and (
      c.id = coalesce(${t.contact_id}::uuid, (select primary_contact_id from crm.deals where id = ${t.deal_id}::uuid))
      or (${t.deal_id}::uuid is null and ${t.contact_id}::uuid is null and c.company_id = ${t.company_id}::uuid and c.kind = 'person'))
    order by c.last_activity_at desc nulls last
    limit 1`);
  return r?.email ? { contactId: r.id, address: r.email, name: r.name, consent: r.consent } : null;
}

const consentWarning = (consent: string) =>
  consent === "unsubscribed"
    ? "This contact unsubscribed from marketing emails. A one-to-one reply about their own enquiry is allowed, but keep it to that."
    : null;

export function parseDraft(text: string | null): StoredDraft | null {
  if (!text) return null;
  try {
    const d = JSON.parse(text) as StoredDraft;
    return typeof d.subject === "string" && typeof d.body === "string" ? d : null;
  } catch {
    return null;
  }
}

async function context(t: Item, sender: { id: string; name: string; email: string }): Promise<DraftContext> {
  const [contact] = await rows<{ first_name: string | null; name: string | null; company: string | null }>(sql`
    select c.first_name, nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '') as name, co.name as company
    from crm.contacts c left join crm.companies co on co.id = c.company_id
    where c.id = coalesce(${t.contact_id}::uuid, (select primary_contact_id from crm.deals where id = ${t.deal_id}::uuid))`);
  const [deal] = t.deal_id
    ? await rows<{ title: string; stage: string; entity: string | null; quote_number: string | null; quote_status: string | null; quote_expires_on: string | null; next_action: string | null }>(sql`
        select title, stage::text as stage, entity, erp_so_number as quote_number, erp_quote_status as quote_status,
               erp_quote_expires_on::text as quote_expires_on, next_action
        from crm.deals where id = ${t.deal_id}`)
    : [];
  const [company] = !contact && t.company_id ? await rows<{ name: string }>(sql`select name from crm.companies where id = ${t.company_id}`) : [];
  // The last few summaries on this deal / contact / company: only what the CRM stores, never email text.
  const scope = t.deal_id
    ? sql`a.deal_id = ${t.deal_id}`
    : t.contact_id
      ? sql`a.contact_id = ${t.contact_id}`
      : sql`(a.company_id = ${t.company_id} or a.contact_id in (select id from crm.contacts where company_id = ${t.company_id}))`;
  const recent = await rows<{ occurred_at: string; direction: string; type: string; subject: string | null; summary: string | null }>(sql`
    select a.occurred_at, a.direction::text as direction, a.type::text as type, a.subject, a.summary
    from crm.activities a where ${scope}
    order by a.occurred_at desc limit 6`);
  const [voice] = await rows<{ value: string }>(sql`select value from crm.settings where key = 'chase_voice_examples'`);

  return {
    today: toLocalDate(new Date())!,
    reason: [t.title, t.detail].filter(Boolean).join(": "),
    sender: { name: sender.name, email: sender.email },
    contact: contact ?? { first_name: null, name: null, company: company?.name ?? null },
    deal: deal
      ? { ...deal, stage: STAGES[deal.stage as Stage]?.label ?? deal.stage, quote_expires_on: deal.quote_expires_on ? formatDate(deal.quote_expires_on) : null }
      : null,
    recent: recent.map((a) => ({ date: formatDate(toLocalDate(a.occurred_at)), direction: a.direction, type: a.type, subject: a.subject, summary: a.summary })),
    voiceExamples: voice?.value ?? null,
  };
}

/** Claude drafts (or re-drafts) the follow-up for this chase item, and the draft is kept on the item. */
export async function draftChase(
  user: { id: string; displayName: string; email: string },
  taskId: string,
  drafter: Drafter | null = claudeConfigured() ? draftWithClaude : null,
): Promise<DraftResult> {
  if (!drafter) return { ok: false, message: "Claude isn't set up on this server (ANTHROPIC_API_KEY)." };
  const t = await loadItem(taskId);
  if (!t) return { ok: false, message: "This item has already been dealt with." };
  const to = await recipient(t);
  if (!to) return { ok: false, message: "There's no contact with an email address on this item. Add one to the contact first." };
  if (to.consent === "bounced") return { ok: false, message: `${to.address} bounced before, so no draft is made. Phone them, or find a new address.` };

  const r = await drafter(await context(t, { id: user.id, name: user.displayName, email: user.email }));
  if ("refused" in r) return { ok: false, message: "Claude declined to draft this one. Please write it yourself." };
  const draft: StoredDraft = { subject: r.subject.trim().slice(0, 200), body: r.body.trim().slice(0, 5000), to: to.address, model: DRAFT_MODEL, drafted_at: new Date().toISOString() };
  await withActor({ type: "claude", profileId: user.id }, (tx) =>
    tx.execute(sql`update crm.tasks set draft_text = ${JSON.stringify(draft)} where id = ${taskId}`),
  );
  return { ok: true, draft, warning: consentWarning(to.consent) };
}

/** Save the (possibly edited) draft into the user's own Outlook Drafts. Nothing is sent. */
export async function saveChaseDraft(
  actor: Actor & { type: "user" },
  taskId: string,
  edited: { subject: string; body: string },
  fetchImpl?: typeof fetch,
): Promise<{ ok: true; link: string } | { ok: false; message: string }> {
  const t = await loadItem(taskId);
  if (!t) return { ok: false, message: "This item has already been dealt with." };
  const to = await recipient(t);
  if (!to) return { ok: false, message: "There's no contact with an email address on this item." };
  if (to.consent === "bounced") return { ok: false, message: `${to.address} bounced before, so the draft isn't saved.` };

  const prev = parseDraft(t.draft_text);
  const saved = await createOutlookDraft(
    actor.profileId,
    { subject: edited.subject, body: edited.body, to: { address: to.address, name: to.name } },
    fetchImpl,
    prev?.outlook_id,
  );
  const draft: StoredDraft = {
    ...(prev ?? { model: DRAFT_MODEL, drafted_at: new Date().toISOString() }),
    subject: edited.subject,
    body: edited.body,
    to: to.address,
    saved_at: new Date().toISOString(),
    outlook_id: saved.id,
    outlook_link: saved.webLink,
  };
  await withActor(actor, (tx) => tx.execute(sql`update crm.tasks set draft_text = ${JSON.stringify(draft)} where id = ${taskId}`));
  return { ok: true, link: saved.webLink };
}
