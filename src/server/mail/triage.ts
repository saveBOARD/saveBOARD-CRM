import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { domainOf, INTERNAL_DOMAINS, isInternal } from "./classify";

// Inbox triage (phase 3.2): inbound email from addresses that match no contact. A person decides: add the sender
// as a contact (their waiting emails are then logged), ignore these emails, or always ignore the sender or domain.
// Nothing here creates a record without someone clicking.

export type TriageSender = {
  from_address: string;
  from_name: string | null;
  emails: number;
  latest_at: string;
  latest_subject: string | null;
  latest_url: string | null;
  mailboxes: string[];
  free_domain: boolean;
  /** A company that already uses the sender's web domain (on the company or on another contact). */
  company_id: string | null;
  company_name: string | null;
};

export async function listTriage(limit = 200): Promise<TriageSender[]> {
  // Three small, separate queries. One combined query let the planner compare every sender with every contact and
  // company: at live volumes it ran for minutes, held the database connections and timed out the whole CRM.
  const senders = await rows<Omit<TriageSender, "free_domain" | "company_id" | "company_name">>(sql`
    select from_address,
           (array_agg(from_name order by received_at desc) filter (where from_name is not null))[1] as from_name,
           count(*)::int as emails,
           max(received_at) as latest_at,
           (array_agg(subject order by received_at desc))[1] as latest_subject,
           (array_agg(external_url order by received_at desc))[1] as latest_url,
           coalesce(array_agg(distinct mailbox) filter (where mailbox is not null), '{}') as mailboxes
    from crm.unmatched_emails
    where status = 'pending'
    group by from_address
    order by max(received_at) desc
    limit ${limit}`);
  if (senders.length === 0) return [];

  const domains = [...new Set(senders.map((s) => domainOf(s.from_address)))];
  const list = sql`(${sql.join(
    domains.map((d) => sql`${d}`),
    sql`, `,
  )})`;
  const [free, byCompany, byContact] = await Promise.all([
    rows<{ domain: string }>(sql`select domain from crm.free_email_domains where domain in ${list}`),
    rows<{ domain: string; id: string; name: string }>(sql`
      select lower(domain) as domain, id, name from crm.companies
      where deleted_at is null and lower(domain) in ${list}
      order by last_activity_at desc nulls last`),
    rows<{ domain: string; id: string; name: string }>(sql`
      select x.domain, c.id, c.name
      from (select split_part(lower(email), '@', 2) as domain, company_id from crm.contacts
            where deleted_at is null and company_id is not null) x
      join crm.companies c on c.id = x.company_id and c.deleted_at is null
      where x.domain in ${list}
      order by c.last_activity_at desc nulls last`),
  ]);

  const freeSet = new Set(free.map((f) => f.domain));
  const suggestion = new Map<string, { id: string; name: string }>();
  for (const c of [...byCompany, ...byContact]) if (!freeSet.has(c.domain) && !suggestion.has(c.domain)) suggestion.set(c.domain, c);

  return senders.map((s) => {
    const d = domainOf(s.from_address);
    const co = suggestion.get(d);
    return { ...s, free_domain: freeSet.has(d), company_id: co?.id ?? null, company_name: co?.name ?? null };
  });
}

export async function countTriage(): Promise<number> {
  const [r] = await rows<{ n: number }>(sql`select count(distinct from_address)::int as n from crm.unmatched_emails where status = 'pending'`);
  return r?.n ?? 0;
}

export type AddSender = {
  address: string;
  first_name: string | null;
  last_name: string | null;
  company: { existingId: string } | { newName: string } | null;
};

/** Create the contact (and a company, if asked), then log every waiting email from them on the contact. */
export async function addSenderAsContact(actor: Actor & { type: "user" }, input: AddSender): Promise<string> {
  const address = input.address.toLowerCase();
  return withActor(actor, async (tx) => {
    const [existing] = await rows<{ id: string }>(
      sql`select id from crm.contacts where lower(email) = ${address} and deleted_at is null`,
      tx,
    );
    let contactId = existing?.id;
    if (!contactId) {
      let companyId: string | null = null;
      if (input.company && "existingId" in input.company) companyId = input.company.existingId;
      if (input.company && "newName" in input.company) {
        const domain = domainOf(address);
        const [co] = await rows<{ id: string }>(
          sql`insert into crm.companies (name, domain, website, owner_id, source)
              values (${input.company.newName}, ${domain}, ${`https://${domain}`}, ${actor.profileId}, 'email')
              returning id`,
          tx,
        );
        companyId = co.id;
      }
      const [c] = await rows<{ id: string }>(
        sql`insert into crm.contacts (first_name, last_name, email, company_id, owner_id, source,
                                      country_code)
            values (${input.first_name}, ${input.last_name}, ${address}, ${companyId}, ${actor.profileId}, 'email',
                    (select country_code from crm.companies where id = ${companyId}))
            returning id`,
        tx,
      );
      contactId = c.id;
    }
    await tx.execute(sql`
      with waiting as (
        select u.id, u.owner_id, u.external_id, u.subject, u.received_at, u.external_url, u.mailbox,
               ct.id as contact_id, ct.company_id
        from crm.unmatched_emails u, crm.contacts ct
        where u.status = 'pending' and u.from_address = ${address} and ct.id = ${contactId}
      ), logged as (
        insert into crm.activities (type, direction, subject, occurred_at, contact_id, company_id, owner_id, origin,
                                    external_id, external_url, metadata)
        select 'email', 'inbound', subject, received_at, contact_id, company_id, owner_id, 'graph',
               external_id || '|' || contact_id, external_url, jsonb_build_object('mailbox', mailbox, 'folder', 'inbox')
        from waiting
        on conflict (origin, external_id) where external_id is not null do nothing
      )
      update crm.unmatched_emails u set status = 'accepted', contact_id = w.contact_id
      from waiting w where u.id = w.id`);
    return contactId;
  });
}

export type IgnoreScope = "once" | "address" | "domain";

/** Ignore the waiting emails; with "address" or "domain", also skip that sender (or whole domain) from now on. */
export async function ignoreSender(actor: Actor & { type: "user" }, address: string, scope: IgnoreScope): Promise<void> {
  const a = address.toLowerCase();
  const domain = domainOf(a);
  if (scope === "domain" && isInternal(a, INTERNAL_DOMAINS)) throw new Error("saveBOARD's own domains can't be ignored");
  await withActor(actor, async (tx) => {
    if (scope === "domain") {
      const [free] = await rows<{ free: boolean }>(sql`select exists (select 1 from crm.free_email_domains where domain = ${domain}) as free`, tx);
      if (free.free) throw new Error(`${domain} is a free-mail domain: ignore the address instead`);
    }
    if (scope !== "once") {
      await tx.execute(sql`insert into crm.mail_ignore (pattern, reason, created_by)
                           values (${scope === "domain" ? domain : a}, 'Inbox triage', ${actor.profileId})
                           on conflict (pattern) do nothing`);
    }
    await tx.execute(sql`
      update crm.unmatched_emails set status = 'ignored'
      where status = 'pending'
        and ${scope === "domain" ? sql`split_part(from_address, '@', 2) = ${domain}` : sql`from_address = ${a}`}`);
  });
}

export type IgnoreRule = { pattern: string; kind: "address" | "domain"; reason: string | null; created_by: string | null; created_at: string };

export async function listIgnoreRules(): Promise<IgnoreRule[]> {
  return rows<IgnoreRule>(sql`
    select i.pattern, i.kind, i.reason, p.display_name as created_by, i.created_at
    from crm.mail_ignore i left join crm.profiles p on p.id = i.created_by
    order by i.created_at desc`);
}

export async function removeIgnoreRule(actor: Actor & { type: "user" }, pattern: string): Promise<void> {
  await withActor(actor, (tx) => tx.execute(sql`delete from crm.mail_ignore where pattern = ${pattern.toLowerCase()}`));
}
