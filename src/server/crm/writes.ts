import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { companyDisplayName } from "./companies";
import type { CompanyInput, ContactInput, NoteInput } from "./schemas";

// Company, contact and note writes. Every write runs in withActor, so the audit log says who did it.

export type Duplicate = { id: string; label: string; href: string; reason: string };

/** Companies that look like the same organisation: same normalised name, or same web domain. */
export async function findCompanyDuplicates(input: { name: string; domain: string | null }, excludeId?: string): Promise<Duplicate[]> {
  const found = await rows<{ id: string; name: string; reason: string }>(sql`
    select c.id, ${companyDisplayName("c")} as name,
           case when c.name_norm = crm.normalize_name(${input.name}) then 'same name' else 'same web domain' end as reason
    from crm.companies c
    where c.deleted_at is null
      and (c.name_norm = crm.normalize_name(${input.name})
           ${input.domain ? sql`or lower(c.domain) = ${input.domain}` : sql``})
      ${excludeId ? sql`and c.id <> ${excludeId}` : sql``}
    limit 5`);
  return found.map((c) => ({ id: c.id, label: c.name, href: `/companies/${c.id}`, reason: c.reason }));
}

/** A contact already using this email (emails are unique in the CRM). */
export async function findContactByEmail(email: string, excludeId?: string): Promise<Duplicate | null> {
  const [c] = await rows<{ id: string; label: string }>(sql`
    select id, coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email) as label
    from crm.contacts
    where lower(email) = lower(${email}) and deleted_at is null
      ${excludeId ? sql`and id <> ${excludeId}` : sql``}`);
  return c ? { id: c.id, label: c.label, href: `/contacts/${c.id}`, reason: "same email" } : null;
}

export async function createCompany(actor: Actor, c: CompanyInput): Promise<string> {
  return withActor(actor, async (tx) => {
    const [r] = await rows<{ id: string }>(
      sql`insert into crm.companies (name, domain, website, segment, country_code, city, owner_id, notes, source)
          values (${c.name}, ${c.domain}, ${c.website}, ${c.segment}, ${c.country_code}, ${c.city}, ${c.owner_id}, ${c.notes}, 'manual')
          returning id`,
      tx,
    );
    return r.id;
  });
}

export async function updateCompany(actor: Actor, id: string, c: CompanyInput): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`
      update crm.companies
         set name = ${c.name}, domain = ${c.domain}, website = ${c.website}, segment = ${c.segment},
             country_code = ${c.country_code}, city = ${c.city}, owner_id = ${c.owner_id}, notes = ${c.notes}
       where id = ${id} and deleted_at is null`),
  );
}

const contactValues = (c: ContactInput) => sql`
  ${c.first_name}, ${c.last_name}, ${c.email}, ${c.phone},
  crm.normalize_phone(${c.phone}, coalesce(${c.country_code}, (select country_code from crm.companies where id = ${c.company_id}))),
  ${c.role_title}, ${c.company_id}, ${c.kind}, ${c.segment}, ${c.country_code}, ${c.city},
  ${c.samples_sent}, ${c.track_followup}, ${c.owner_id}, ${c.notes}`;

export async function createContact(actor: Actor, c: ContactInput): Promise<string> {
  return withActor(actor, async (tx) => {
    const [r] = await rows<{ id: string }>(
      sql`insert into crm.contacts (first_name, last_name, email, phone_raw, phone_e164, role_title, company_id, kind, segment,
                                    country_code, city, samples_sent, track_followup, owner_id, notes, source)
          values (${contactValues(c)}, 'manual')
          returning id`,
      tx,
    );
    return r.id;
  });
}

export async function updateContact(actor: Actor, id: string, c: ContactInput): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`
      update crm.contacts
         set (first_name, last_name, email, phone_raw, phone_e164, role_title, company_id, kind, segment,
              country_code, city, samples_sent, track_followup, owner_id, notes) = (${contactValues(c)})
       where id = ${id} and deleted_at is null`),
  );
}

/** A manual note on a company, contact or deal. It is an activity, so it resets the 7-day clock. */
export async function addNote(
  actor: Actor & { type: "user" },
  target: { companyId?: string; contactId?: string; dealId?: string },
  n: NoteInput,
): Promise<string> {
  return withActor(actor, async (tx) => {
    const [r] = await rows<{ id: string }>(
      sql`insert into crm.activities (type, direction, summary, occurred_at, company_id, contact_id, deal_id, owner_id, origin)
          values ('note', 'internal', ${n.summary},
                  ${n.occurred_on ? sql`(${n.occurred_on}::date + time '12:00') at time zone 'Pacific/Auckland'` : sql`now()`},
                  ${target.companyId ?? null}, ${target.contactId ?? null}, ${target.dealId ?? null}, ${actor.profileId}, 'manual')
          returning id`,
      tx,
    );
    return r.id;
  });
}

/** Soft delete (admins only, checked by the caller). Nothing is hard-deleted. */
export async function softDelete(actor: Actor, table: "companies" | "contacts", id: string): Promise<void> {
  await withActor(actor, (tx) =>
    table === "companies"
      ? tx.execute(sql`update crm.companies set deleted_at = now() where id = ${id} and deleted_at is null`)
      : tx.execute(sql`update crm.contacts set deleted_at = now() where id = ${id} and deleted_at is null`),
  );
}

/** Company look-up for forms: name or domain contains the text. */
export async function searchCompanies(q: string, limit = 20): Promise<{ id: string; name: string; detail: string | null }[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return rows(sql`
    select c.id, ${companyDisplayName("c")} as name, c.domain as detail
    from crm.companies c
    where c.deleted_at is null and (c.name ilike ${like} or c.domain ilike ${like})
    order by (c.name_norm = crm.normalize_name(${term})) desc, c.last_activity_at desc nulls last, c.name
    limit ${limit}`);
}

export async function listUsers(): Promise<{ id: string; name: string }[]> {
  return rows(sql`select id, display_name as name from crm.profiles where active order by display_name`);
}
