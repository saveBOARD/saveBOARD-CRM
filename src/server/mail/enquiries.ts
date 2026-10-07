import "server-only";
import { sql } from "drizzle-orm";
import { rows, type Tx } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import {
  extractEnquiryWithClaude,
  extractOrderWithClaude,
  type EnquiryExtractor,
  type ExtractedEnquiry,
  type ExtractedOrder,
  type OrderExtractor,
} from "@/server/claude/enquiry";
import { claudeConfigured } from "@/server/claude/summarise";
import { domainOf, normaliseAddress } from "./classify";
import { MailNotConnected } from "./graph";
import { fetchMessageText, messageText } from "./text";

// Website enquiries (phase 3.4, approved plan): each website form email in the shared mailboxes becomes (or matches)
// a contact, and a New enquiry deal with the mailbox's entity, source Website form and an owner from the pair for that
// country (alternating). The subscribe tick is explicit marketing consent, unless the address is on the do-not-email
// list. Forms older than web_enquiry_deal_max_age_days (from the 90-day read-back) create the contact and log the
// enquiry but open no deal. Claude extracts the details; these writes are logged as Claude.
// Shop orders (confirmed by Paul, 9 Oct 2026): logged on the buyer's timeline (contact created if new), samples sent
// ticked for sample orders, no deal.

const MAX_ATTEMPTS = 3;

type Pending = {
  id: string;
  kind: "form" | "shop_order";
  mailbox: string;
  entity: "NZ" | "AUS";
  external_id: string;
  message_id: string | null;
  reader_id: string | null;
  subject: string | null;
  received_at: string;
  attempts: number;
};

export type EnquiryRun = { attempted: number; created: number; deals: number; orders: number; skipped: number; failed: number; note?: string };

const clean = (s: string | null | undefined, max = 200) => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** The next owner from the country's pair: the one after whoever got the last website-form deal. */
async function nextOwner(entity: "NZ" | "AUS", tx: Tx): Promise<string | null> {
  const key = entity === "NZ" ? "web_enquiry_owners_nz" : "web_enquiry_owners_aus";
  const pair = await rows<{ id: string }>(
    sql`select p.id from unnest(string_to_array((select value from crm.settings where key = ${key}), ',')) with ordinality as e(email, n)
        join crm.profiles p on lower(p.email) = lower(trim(e.email)) and p.active
        order by e.n`,
    tx,
  );
  if (pair.length === 0) return null;
  const [last] = await rows<{ owner_id: string | null }>(
    sql`select owner_id from crm.deals where source = 'website_form' and entity = ${entity} and deleted_at is null
        order by created_at desc limit 1`,
    tx,
  );
  const i = pair.findIndex((p) => p.id === last?.owner_id);
  return pair[(i + 1) % pair.length].id;
}

async function findOrCreateCompany(company: string | null, email: string | null, country: string, ownerId: string | null, tx: Tx): Promise<string | null> {
  const name = clean(company);
  const domain = email ? domainOf(email) : null;
  const [free] = domain ? await rows<{ free: boolean }>(sql`select exists (select 1 from crm.free_email_domains where domain = ${domain}) as free`, tx) : [{ free: true }];
  const businessDomain = domain && !free.free ? domain : null;

  if (name || businessDomain) {
    const [found] = await rows<{ id: string }>(
      sql`select id from crm.companies
          where deleted_at is null
            and (${name ? sql`name_norm = crm.normalize_name(${name})` : sql`false`}
                 or ${businessDomain ? sql`lower(domain) = ${businessDomain}` : sql`false`})
          order by last_activity_at desc nulls last limit 1`,
      tx,
    );
    if (found) return found.id;
  }
  if (!name) return null;
  const [co] = await rows<{ id: string }>(
    sql`insert into crm.companies (name, domain, website, country_code, owner_id, source)
        values (${name}, ${businessDomain}, ${businessDomain ? `https://${businessDomain}` : null}, ${country}, ${ownerId}, 'form')
        returning id`,
    tx,
  );
  return co.id;
}

/** Turn one extracted form into records. Returns the contact and the deal (if one was opened or found). */
export async function recordEnquiry(p: Pending, e: ExtractedEnquiry, opts: { maxAgeDays: number; now?: Date }) {
  const country = p.entity === "NZ" ? "NZ" : "AU";
  const currency = p.entity === "NZ" ? "NZD" : "AUD";
  const email = normaliseAddress(e.email);
  const fresh = (opts.now ?? new Date()).getTime() - new Date(p.received_at).getTime() <= opts.maxAgeDays * 86_400_000;

  return withActor({ type: "claude", profileId: p.reader_id }, async (tx) => {
    const ownerId = await nextOwner(p.entity, tx);

    // Contact: match on email (unique in the CRM); otherwise create one.
    const [existing] = email
      ? await rows<{ id: string; company_id: string | null; owner_id: string | null }>(
          sql`select id, company_id, owner_id from crm.contacts where lower(email) = ${email} and deleted_at is null`,
          tx,
        )
      : [];
    const companyId = existing?.company_id ?? (await findOrCreateCompany(e.company, email, country, ownerId, tx));
    const notes = [
      e.region && `Region: ${clean(e.region)}`,
      e.postcode && `Postcode: ${clean(e.postcode, 20)}`,
      e.customer_type && `Customer type: ${clean(e.customer_type)}`,
      e.heard_about && `Heard about us: ${clean(e.heard_about)}`,
    ].filter(Boolean);

    let contactId = existing?.id;
    if (!contactId) {
      const [c] = await rows<{ id: string }>(
        sql`insert into crm.contacts (first_name, last_name, email, phone_raw, phone_e164, company_id, country_code, owner_id, source, notes)
            values (${clean(e.first_name, 100)}, ${clean(e.last_name, 100)}, ${email}, ${clean(e.phone, 50)},
                    crm.normalize_phone(${clean(e.phone, 50)}, ${country}), ${companyId}, ${country}, ${ownerId}, 'form',
                    ${notes.length ? `Website form: ${notes.join("; ")}` : null})
            returning id`,
        tx,
      );
      contactId = c.id;
    } else {
      // Fill gaps only; never overwrite what someone has entered.
      await tx.execute(sql`
        update crm.contacts
           set phone_raw = coalesce(phone_raw, ${clean(e.phone, 50)}),
               phone_e164 = coalesce(phone_e164, crm.normalize_phone(${clean(e.phone, 50)}, ${country})),
               company_id = coalesce(company_id, ${companyId}),
               first_name = coalesce(first_name, ${clean(e.first_name, 100)}),
               last_name = coalesce(last_name, ${clean(e.last_name, 100)})
         where id = ${contactId}`);
    }

    // The subscribe tick is explicit consent, unless the address is on the do-not-email list.
    if (e.subscribe === true && email) {
      await tx.execute(sql`
        update crm.contacts set consent_status = 'subscribed', consent_source = 'website form', consent_at = ${p.received_at}::timestamptz
        where id = ${contactId} and consent_status not in ('unsubscribed', 'bounced')
          and not exists (select 1 from crm.email_suppressions s where s.email = ${email})`);
    }

    // Deal: reuse the contact's open deal in this country, else open a New enquiry (recent forms only).
    const [open] = await rows<{ id: string }>(
      sql`select id from crm.deals where primary_contact_id = ${contactId} and entity = ${p.entity} and deleted_at is null
            and stage not in ('won', 'lost') order by created_at desc limit 1`,
      tx,
    );
    let dealId = open?.id ?? null;
    let opened = false;
    if (!dealId && fresh) {
      const who = clean([e.first_name, e.last_name].filter(Boolean).join(" ")) ?? email ?? "visitor";
      const [d] = await rows<{ id: string }>(
        sql`insert into crm.deals (title, company_id, primary_contact_id, entity, est_currency, stage, source, owner_id, next_action, created_at)
            values (${`Website enquiry: ${clean(e.company) ?? who}`.slice(0, 200)}, ${companyId}, ${contactId}, ${p.entity}, ${currency},
                    'new_enquiry', 'website_form', ${ownerId}, ${clean(e.next_step, 300)}, ${p.received_at}::timestamptz)
            returning id`,
        tx,
      );
      dealId = d.id;
      opened = true;
    }

    // The enquiry on the timeline: Claude's summary and the form's details, never the email itself.
    const owner = await rows<{ owner_id: string | null }>(sql`select owner_id from crm.deals where id = ${dealId}`, tx);
    const meta = {
      mailbox: p.mailbox,
      summary_status: "done",
      next_step: clean(e.next_step, 300),
      form: {
        customer_type: clean(e.customer_type),
        products: e.products.map((x) => clean(x)).filter(Boolean).slice(0, 20),
        region: clean(e.region),
        postcode: clean(e.postcode, 20),
        heard_about: clean(e.heard_about),
        subscribe: e.subscribe,
      },
    };
    await tx.execute(sql`
      insert into crm.activities (type, direction, subject, summary, occurred_at, contact_id, company_id, deal_id, owner_id, origin, external_id, metadata)
      values ('email', 'inbound', ${p.subject}, ${clean(e.summary, 1000)}, ${p.received_at}::timestamptz, ${contactId}, ${companyId}, ${dealId},
              ${owner[0]?.owner_id ?? ownerId}, 'form', ${`${p.external_id}|${contactId}`}, ${JSON.stringify(meta)}::jsonb)
      on conflict (origin, external_id) where external_id is not null do nothing`);

    await tx.execute(sql`
      update crm.web_enquiries set status = 'done', contact_id = ${contactId}, deal_id = ${dealId}, processed_at = now(), error = null
      where id = ${p.id}`);
    return { contactId, dealId, opened, created: !existing };
  });
}

/** Log one shop order on the buyer's timeline. */
export async function recordOrder(p: Pending, o: ExtractedOrder) {
  const country = o.country === "NZ" || o.country === "AU" ? o.country : p.entity === "NZ" ? "NZ" : "AU";
  const email = normaliseAddress(o.email);
  return withActor({ type: "claude", profileId: p.reader_id }, async (tx) => {
    const [existing] = email
      ? await rows<{ id: string }>(sql`select id from crm.contacts where lower(email) = ${email} and deleted_at is null`, tx)
      : [];
    let contactId = existing?.id;
    if (!contactId) {
      const ownerId = await nextOwner(country === "NZ" ? "NZ" : "AUS", tx);
      const companyId = await findOrCreateCompany(o.company, email, country, ownerId, tx);
      const [c] = await rows<{ id: string }>(
        sql`insert into crm.contacts (first_name, last_name, email, phone_raw, phone_e164, company_id, country_code, city, owner_id, source, samples_sent)
            values (${clean(o.first_name, 100)}, ${clean(o.last_name, 100)}, ${email}, ${clean(o.phone, 50)},
                    crm.normalize_phone(${clean(o.phone, 50)}, ${country}), ${companyId}, ${country}, ${clean(o.city, 100)}, ${ownerId},
                    'shop', ${o.is_sample_order})
            returning id`,
        tx,
      );
      contactId = c.id;
    } else {
      await tx.execute(sql`
        update crm.contacts
           set phone_raw = coalesce(phone_raw, ${clean(o.phone, 50)}),
               phone_e164 = coalesce(phone_e164, crm.normalize_phone(${clean(o.phone, 50)}, ${country})),
               samples_sent = samples_sent or ${o.is_sample_order}
         where id = ${contactId}`);
    }

    // On the timeline, linked to the buyer's open deal if they have one. No deal is created for an order.
    const [c] = await rows<{ company_id: string | null; owner_id: string | null; deal_id: string | null }>(
      sql`select c.company_id, c.owner_id,
                 (select d.id from crm.deals d where d.primary_contact_id = c.id and d.deleted_at is null and d.stage not in ('won', 'lost')
                   order by d.created_at desc limit 1) as deal_id
          from crm.contacts c where c.id = ${contactId}`,
      tx,
    );
    const meta = {
      mailbox: p.mailbox,
      summary_status: "done",
      shop_order: {
        number: clean(o.order_number, 40),
        items: o.items.slice(0, 30).map((i) => ({ name: clean(i.name), quantity: i.quantity })),
        samples: o.is_sample_order,
      },
    };
    await tx.execute(sql`
      insert into crm.activities (type, direction, subject, summary, occurred_at, contact_id, company_id, deal_id, owner_id, origin, external_id, metadata)
      values ('email', 'inbound', ${p.subject}, ${clean(o.summary, 1000)}, ${p.received_at}::timestamptz, ${contactId}, ${c.company_id}, ${c.deal_id},
              ${c.owner_id}, 'form', ${`${p.external_id}|${contactId}`}, ${JSON.stringify(meta)}::jsonb)
      on conflict (origin, external_id) where external_id is not null do nothing`);
    await tx.execute(sql`
      update crm.web_enquiries set status = 'done', contact_id = ${contactId}, deal_id = ${c.deal_id}, processed_at = now(), error = null
      where id = ${p.id}`);
    return { contactId, created: !existing };
  });
}

async function markFailed(p: Pending, status: "failed" | "skipped" | "pending", error: string | null) {
  await withActor({ type: "claude", profileId: p.reader_id }, (tx) =>
    tx.execute(sql`update crm.web_enquiries set status = ${status}, attempts = attempts + ${status === "skipped" ? 0 : 1},
                   error = ${error}, processed_at = case when ${status} = 'pending' then null else now() end
                   where id = ${p.id}`),
  );
}

/** Process waiting website forms, newest first, within the time budget. */
export async function processWebEnquiries(
  opts: { budgetMs?: number; extract?: EnquiryExtractor; extractOrder?: OrderExtractor; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<EnquiryRun> {
  const result: EnquiryRun = { attempted: 0, created: 0, deals: 0, orders: 0, skipped: 0, failed: 0 };
  const extract = opts.extract ?? (claudeConfigured() ? extractEnquiryWithClaude : null);
  const extractOrder = opts.extractOrder ?? (claudeConfigured() ? extractOrderWithClaude : null);
  if (!extract || !extractOrder) return { ...result, note: "ANTHROPIC_API_KEY is not set" };
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);

  const [setting] = await rows<{ days: number | null }>(sql`select crm.setting_int('web_enquiry_deal_max_age_days') as days`);
  const maxAgeDays = setting?.days ?? 7;
  const queue = await rows<Pending>(sql`
    select id, kind, mailbox, entity, external_id, message_id, reader_id, subject, received_at, attempts
    from crm.web_enquiries
    where status = 'pending' and attempts < ${MAX_ATTEMPTS} and reader_id is not null
    order by received_at desc
    limit 20`);

  for (const p of queue) {
    if (Date.now() > deadline - 8_000) break;
    result.attempted++;
    try {
      const msg = await fetchMessageText(p.reader_id!, p.mailbox, p.message_id, p.external_id, opts.fetchImpl);
      if (!msg) {
        await markFailed(p, "skipped", "The email was deleted before it was read");
        result.skipped++;
        continue;
      }
      const input = { subject: p.subject, receivedAt: p.received_at, text: messageText(msg) || "(no text)" };
      if (p.kind === "shop_order") {
        const o = await extractOrder(input);
        if ("refused" in o || !o.is_order || (!o.email && !o.phone)) {
          await markFailed(p, "skipped", "refused" in o ? "Claude declined this email" : !o.is_order ? "Not a customer order" : "No email or phone in the order");
          result.skipped++;
          continue;
        }
        const r = await recordOrder(p, o);
        result.orders++;
        if (r.created) result.created++;
        continue;
      }
      const e = await extract(input);
      if ("refused" in e || !e.is_enquiry || (!e.email && !e.phone)) {
        await markFailed(p, "skipped", "refused" in e ? "Claude declined this email" : !e.is_enquiry ? "Not a real enquiry (spam or test)" : "No email or phone in the form");
        result.skipped++;
        continue;
      }
      const r = await recordEnquiry(p, e, { maxAgeDays, now: opts.now });
      if (r.created) result.created++;
      if (r.opened) result.deals++;
    } catch (err) {
      if (err instanceof MailNotConnected) {
        result.note = err.message;
        break;
      }
      result.failed++;
      await markFailed(p, p.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending", err instanceof Error ? err.message.slice(0, 200) : "failed");
    }
  }
  return result;
}

export type EnquiryStatus = { kind: string; status: string; n: number };

export async function webEnquiryStatus(): Promise<EnquiryStatus[]> {
  return rows<EnquiryStatus>(sql`select kind, status, count(*)::int as n from crm.web_enquiries group by kind, status order by kind, status`);
}
