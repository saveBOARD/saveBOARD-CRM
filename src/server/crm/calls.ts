import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { claudeConfigured } from "@/server/claude/summarise";
import { readCallNoteWithClaude, type CallNote, type CallNoteReader } from "@/server/claude/call-note";
import { splitName } from "@/server/mail/classify";
import { toLocalDate } from "@/lib/format";

// Call notes (phase 4.1-4.2). After a call, a person dictates or types a short note; Claude suggests who it was with,
// a summary, the next step, a follow-up date and any stage change; the person confirms (or changes) each part, and only
// then does it become a call on the timeline, a task and (if ticked) a stage move. Notes live in crm.voice_notes and
// are deleted after the retention period (2 years) like captured email.

export type CallUser = { id: string; displayName: string };
export type Candidate = { id: string; name: string; company: string | null; email: string | null; reason: string };
export type OpenDeal = { id: string; title: string; stage: string; entity: string | null };
export type CallNoteView = {
  id: string;
  status: string;
  note: string | null;
  created_at: string;
  extracted: CallNote | null;
  contact_id: string | null;
  deal_id: string | null;
  activity_id: string | null;
};

/** Save the note and have Claude read it. Returns the note's id (for the confirm screen). */
export async function createCallNote(
  user: CallUser,
  input: { note: string; contactId?: string | null; dealId?: string | null },
  reader: CallNoteReader | null = claudeConfigured() ? readCallNoteWithClaude : null,
): Promise<string> {
  const note = input.note.trim().slice(0, 8000);
  const [created] = await withActor({ type: "user", profileId: user.id }, (tx) =>
    rows<{ id: string }>(
      sql`insert into crm.voice_notes (owner_id, transcript, status, contact_id, deal_id)
          values (${user.id}, ${note}, 'transcribed', ${input.contactId ?? null}, ${input.dealId ?? null}) returning id`,
      tx,
    ),
  );
  if (!reader) return created.id;

  let known: string | null = null;
  if (input.contactId) {
    const [c] = await rows<{ label: string }>(sql`
      select concat_ws(', ', nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), co.name) as label
      from crm.contacts c left join crm.companies co on co.id = c.company_id where c.id = ${input.contactId}`);
    known = c?.label ?? null;
  }
  try {
    const r = await reader({ note, today: toLocalDate(new Date())!, caller: user.displayName, knownContact: known });
    if (!("refused" in r)) {
      await withActor({ type: "claude", profileId: user.id }, (tx) =>
        tx.execute(sql`update crm.voice_notes set extracted = ${JSON.stringify(r)}::jsonb, summary = ${r.summary}, status = 'summarised'
                       where id = ${created.id}`),
      );
    }
  } catch {
    // Claude unavailable: the note is kept and confirmed by hand.
  }
  return created.id;
}

export async function getCallNote(id: string, userId: string): Promise<CallNoteView | null> {
  const [n] = await rows<CallNoteView>(sql`
    select id, status, transcript as note, created_at, extracted, contact_id, deal_id, activity_id
    from crm.voice_notes where id = ${id} and owner_id = ${userId}`);
  return n ?? null;
}

/** Notes this user hasn't confirmed or discarded yet, newest first. */
export async function listWaitingNotes(userId: string) {
  return rows<{ id: string; created_at: string; summary: string | null; note: string | null }>(sql`
    select id, created_at, summary, left(transcript, 120) as note from crm.voice_notes
    where owner_id = ${userId} and status in ('transcribed', 'summarised') order by created_at desc limit 10`);
}

const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/**
 * Contacts the note might be about: the one it was logged from, people matching the name (and company) Claude heard,
 * an email or phone said in the note, then people at a matching company. Plain indexed and ilike queries only.
 */
export async function suggestContacts(x: CallNote | null, presetContactId: string | null): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  const add = (list: Omit<Candidate, "reason">[], reason: string) => list.forEach((c) => out.has(c.id) || out.set(c.id, { ...c, reason }));
  const select = sql`select c.id, coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email) as name,
                            co.name as company, c.email
                     from crm.contacts c left join crm.companies co on co.id = c.company_id and co.deleted_at is null`;

  if (presetContactId) add(await rows(sql`${select} where c.id = ${presetContactId} and c.deleted_at is null`), "Logged from this contact");
  if (x?.email) add(await rows(sql`${select} where lower(c.email) = ${x.email.trim().toLowerCase()} and c.deleted_at is null`), "Email in the note");
  if (x?.phone) {
    const digits = x.phone.replace(/\D/g, "").replace(/^0/, "");
    if (digits.length >= 7) add(await rows(sql`${select} where c.deleted_at is null and c.phone_e164 like ${`%${digits}`} limit 5`), "Phone in the note");
  }
  if (x?.person_name) {
    const { first, last } = splitName(x.person_name, "");
    if (first || last) {
      const company = x.company_name?.trim() ?? "";
      add(
        await rows(sql`${select}
          where c.deleted_at is null
            ${first ? sql`and c.first_name ilike ${likeOf(first.split(" ")[0])}` : sql``}
            ${last ? sql`and c.last_name ilike ${likeOf(last)}` : sql``}
          order by ${company ? sql`(co.name ilike ${likeOf(company)}) desc,` : sql``} c.last_activity_at desc nulls last
          limit 6`),
        "Name in the note",
      );
    }
  }
  if (x?.company_name && x.company_name.trim().length >= 3) {
    add(
      await rows(sql`${select}
        where c.deleted_at is null and co.name ilike ${likeOf(x.company_name.trim())}
        order by c.last_activity_at desc nulls last limit 5`),
      "Works at the company in the note",
    );
  }
  return [...out.values()].slice(0, 8);
}

export async function openDealsFor(contactId: string): Promise<OpenDeal[]> {
  return rows<OpenDeal>(sql`
    select d.id, d.title, d.stage::text as stage, d.entity from crm.deals d
    where d.deleted_at is null and d.stage not in ('won', 'lost')
      and (d.primary_contact_id = ${contactId}
           or d.company_id = (select company_id from crm.contacts where id = ${contactId}))
    order by (d.primary_contact_id = ${contactId}) desc, d.last_activity_at desc nulls last limit 10`);
}

export type ConfirmInput = {
  summary: string;
  contact: { id: string } | { new: { first_name: string | null; last_name: string | null; company: string | null; phone: string | null; email: string | null } };
  deal: { id: string } | { new: { title: string; entity: "NZ" | "AUS" } } | null;
  nextStep: string | null;
  followUpOn: string | null; // YYYY-MM-DD
  stage: string | null; // only applied to an existing deal, when ticked
};

const STAGES = ["contacted", "qualified", "quote_sent", "negotiation", "won", "lost"];

/** The person's confirmation: the call goes on the timeline, with a follow-up task and stage move if chosen. */
export async function confirmCallNote(actor: Actor & { type: "user" }, noteId: string, c: ConfirmInput): Promise<{ contactId: string; dealId: string | null }> {
  return withActor(actor, async (tx) => {
    const [note] = await rows<{ id: string; status: string; created_at: string; extracted: CallNote | null }>(
      sql`select id, status, created_at, extracted from crm.voice_notes where id = ${noteId} and owner_id = ${actor.profileId} for update`,
      tx,
    );
    if (!note || !["transcribed", "summarised"].includes(note.status)) throw new Error("This note has already been dealt with.");

    let contactId: string;
    if ("id" in c.contact) contactId = c.contact.id;
    else {
      const n = c.contact.new;
      let companyId: string | null = null;
      if (n.company?.trim()) {
        const [co] = await rows<{ id: string }>(
          sql`select id from crm.companies where deleted_at is null and name_norm = crm.normalize_name(${n.company.trim()}) limit 1`,
          tx,
        );
        companyId = co?.id ?? (await rows<{ id: string }>(sql`insert into crm.companies (name, owner_id, source) values (${n.company.trim()}, ${actor.profileId}, 'call') returning id`, tx))[0].id;
      }
      const [ct] = await rows<{ id: string }>(
        sql`insert into crm.contacts (first_name, last_name, email, phone_raw, phone_e164, company_id, owner_id, source)
            values (${n.first_name}, ${n.last_name}, ${n.email?.trim().toLowerCase() || null}, ${n.phone},
                    crm.normalize_phone(${n.phone}, (select country_code from crm.companies where id = ${companyId})),
                    ${companyId}, ${actor.profileId}, 'call')
            returning id`,
        tx,
      );
      contactId = ct.id;
    }

    let dealId: string | null = null;
    if (c.deal && "id" in c.deal) dealId = c.deal.id;
    if (c.deal && "new" in c.deal) {
      const [d] = await rows<{ id: string }>(
        sql`insert into crm.deals (title, primary_contact_id, company_id, entity, est_currency, stage, source, owner_id, next_action)
            values (${c.deal.new.title}, ${contactId}, (select company_id from crm.contacts where id = ${contactId}), ${c.deal.new.entity},
                    ${c.deal.new.entity === "NZ" ? "NZD" : "AUD"}, 'contacted', 'phone', ${actor.profileId}, ${c.nextStep})
            returning id`,
        tx,
      );
      dealId = d.id;
    }

    const [act] = await rows<{ id: string }>(
      sql`insert into crm.activities (type, direction, summary, occurred_at, contact_id, company_id, deal_id, owner_id, origin, external_id, metadata)
          values ('call', 'internal', ${c.summary}, ${note.created_at}::timestamptz, ${contactId},
                  (select company_id from crm.contacts where id = ${contactId}), ${dealId}, ${actor.profileId}, 'voice', ${`note:${noteId}`},
                  ${JSON.stringify({ next_step: c.nextStep, follow_up_on: c.followUpOn, summary_status: "done", call_note: noteId })}::jsonb)
          returning id`,
      tx,
    );

    if (c.followUpOn) {
      await tx.execute(sql`
        insert into crm.tasks (title, due_on, deal_id, contact_id, assigned_to, source, rule, created_by_claude)
        values (${(c.nextStep ?? "Follow up the call").slice(0, 200)}, ${c.followUpOn}::date, ${dealId}, ${dealId ? null : contactId},
                ${actor.profileId}, 'voice', 'call_follow_up', ${note.extracted?.follow_up_date === c.followUpOn})`);
    }
    if (c.stage && STAGES.includes(c.stage) && dealId && c.deal && "id" in c.deal) {
      await tx.execute(sql`
        update crm.deals set stage = ${c.stage}::crm.deal_stage,
               lost_reason = case when ${c.stage} = 'lost' and lost_reason is null then 'From a call note' else lost_reason end
        where id = ${dealId} and stage not in ('won', 'lost')`);
    }
    await tx.execute(sql`update crm.voice_notes set status = 'confirmed', summary = ${c.summary}, contact_id = ${contactId},
                         deal_id = ${dealId}, activity_id = ${act.id} where id = ${noteId}`);
    return { contactId, dealId };
  });
}

/** Discard: the note's text is removed straight away (nothing was confirmed, so nothing is kept). */
export async function discardCallNote(actor: Actor & { type: "user" }, noteId: string): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`update crm.voice_notes set status = 'discarded', transcript = null, summary = null, extracted = null
                   where id = ${noteId} and owner_id = ${actor.profileId} and status in ('transcribed', 'summarised')`),
  );
}

/** "Sarah Jones, Smith Builders" or the deal's title, for a note started from a contact or deal page. */
export async function aboutLabel(contactId: string | null, dealId: string | null): Promise<string | null> {
  if (dealId) {
    const [d] = await rows<{ title: string }>(sql`select title from crm.deals where id = ${dealId} and deleted_at is null`);
    if (d) return d.title;
  }
  if (contactId) {
    const [c] = await rows<{ label: string }>(sql`
      select concat_ws(', ', nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), co.name) as label
      from crm.contacts c left join crm.companies co on co.id = c.company_id where c.id = ${contactId} and c.deleted_at is null`);
    if (c) return c.label;
  }
  return null;
}
