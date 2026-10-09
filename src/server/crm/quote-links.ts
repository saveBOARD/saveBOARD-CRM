import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { getErpCustomerDetail, getQuote, quoteBelongsToCompany, type Entity } from "@/server/erp";

// Linking deals to ERP quotes (phase 5.1). A person links a deal to one of its customer's quotes (or accepts the CRM's
// suggestion); the CRM then copies the quote's status, value and expiry onto the deal (refresh_deal_erp_mirror). The
// ERP is never written to.

export type LinkResult = { ok: true } | { ok: false; message: string };

type DealRow = { id: string; company_id: string | null; entity: Entity | null; erp_so_number: string | null };

export async function linkQuote(actor: Actor & { type: "user" }, dealId: string, number: string): Promise<LinkResult> {
  const so = number.trim().toUpperCase();
  const [deal] = await rows<DealRow>(sql`select id, company_id, entity, erp_so_number from crm.deals where id = ${dealId} and deleted_at is null`);
  if (!deal) return { ok: false, message: "This deal no longer exists." };
  if (!deal.entity) return { ok: false, message: "Set the deal's country (NZ or AUS) first." };
  if (!deal.company_id) return { ok: false, message: "Set the deal's company first: quotes are found through its ERP customer." };
  if (!(await quoteBelongsToCompany(deal.company_id, deal.entity, so))) {
    return { ok: false, message: `${so} isn't a ${deal.entity} quote or order for this company's ERP customer.` };
  }
  const [other] = await rows<{ title: string }>(
    sql`select title from crm.deals where entity = ${deal.entity} and erp_so_number = ${so} and id <> ${dealId} and deleted_at is null`,
  );
  if (other) return { ok: false, message: `${so} is already linked to the deal "${other.title}".` };

  await withActor(actor, async (tx) => {
    await tx.execute(sql`update crm.deals set erp_so_number = ${so} where id = ${dealId}`);
    await tx.execute(sql`select crm.refresh_deal_erp_mirror()`);
    // A suggestion for this quote is now settled.
    await tx.execute(sql`
      update crm.tasks set status = 'done', closed_reason = 'accepted', completed_at = now()
       where status = 'open' and id in (select task_id from crm.erp_quote_suggestions where entity = ${deal.entity} and so_number = ${so})`);
    await tx.execute(sql`
      update crm.erp_quote_suggestions set status = 'accepted', decided_by = ${actor.profileId}, decided_at = now(), deal_id = ${dealId}
       where entity = ${deal.entity} and so_number = ${so} and status = 'pending'`);
  });
  return { ok: true };
}

export async function unlinkQuote(actor: Actor & { type: "user" }, dealId: string): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`
      update crm.deals set erp_so_number = null, erp_status = null, erp_quote_status = null, erp_total = null, erp_currency = null,
                           erp_quote_expires_on = null, erp_synced_at = null
       where id = ${dealId}`),
  );
}

type Suggestion = { id: string; entity: Entity; so_number: string; company_id: string; deal_id: string | null; status: string };

async function suggestionFor(taskId: string): Promise<Suggestion | null> {
  const [s] = await rows<Suggestion>(sql`select id, entity, so_number, company_id, deal_id, status from crm.erp_quote_suggestions where task_id = ${taskId}`);
  return s ?? null;
}

/** Accept: link the quote to the suggested deal, or open a deal for it and link it. Returns the deal's id. */
export async function acceptQuoteSuggestion(actor: Actor & { type: "user" }, taskId: string): Promise<{ ok: true; dealId: string } | { ok: false; message: string }> {
  const s = await suggestionFor(taskId);
  if (!s || s.status !== "pending") return { ok: false, message: "This suggestion has already been dealt with." };
  let dealId = s.deal_id;
  if (!dealId) {
    const q = await getQuote(s.entity, s.so_number);
    if (!q) return { ok: false, message: `${s.so_number} is no longer in the ERP.` };
    const [d] = await withActor(actor, (tx) =>
      rows<{ id: string }>(
        sql`insert into crm.deals (title, company_id, entity, est_currency, est_value, stage, source, owner_id)
            values (${(q.quote.title?.trim() || `${q.quote.customer_name ?? "ERP"} quote ${s.so_number}`).slice(0, 200)}, ${s.company_id}, ${s.entity},
                    ${s.entity === "NZ" ? "NZD" : "AUD"}, ${q.quote.subtotal}::numeric,
                    ${q.quote.quote_status === "sent" ? "quote_sent" : "qualified"}::crm.deal_stage, 'existing_customer',
                    coalesce((select owner_id from crm.companies where id = ${s.company_id}), ${actor.profileId}))
            returning id`,
        tx,
      ),
    );
    dealId = d.id;
  }
  const r = await linkQuote(actor, dealId, s.so_number);
  return r.ok ? { ok: true, dealId } : r;
}

export async function dismissQuoteSuggestion(actor: Actor & { type: "user" }, taskId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.execute(sql`update crm.erp_quote_suggestions set status = 'dismissed', decided_by = ${actor.profileId}, decided_at = now()
                         where task_id = ${taskId} and status = 'pending'`);
    await tx.execute(sql`update crm.tasks set status = 'dismissed', closed_reason = 'dismissed', completed_at = now() where id = ${taskId} and status = 'open'`);
  });
}

export async function refreshQuoteSuggestions(): Promise<number> {
  const [r] = await withActor({ type: "system", reason: "erp_sync" }, (tx) => rows<{ n: number }>(sql`select crm.refresh_quote_suggestions() as n`, tx));
  return r?.n ?? 0;
}

export type CompanyCandidate = { company_id: string; company_name: string; method: string; score: number };

/** The likely CRM companies for one ERP customer, best first (crm.erp_customer_candidates, migration 16). */
export async function companyCandidates(entity: Entity, erpCustomerId: string): Promise<CompanyCandidate[]> {
  return rows<CompanyCandidate>(sql`select company_id, company_name, method, score::float as score from crm.erp_customer_candidates(${entity}, ${erpCustomerId})`);
}

/**
 * After an ERP customer is linked to a CRM company: its quotes stop waiting as "unlinked", the "Link ERP customer"
 * item closes, and the refresh suggests each quote for a deal as usual.
 */
export async function settleCustomerLink(actor: Actor & { type: "user" }, entity: Entity, erpCustomerId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.execute(sql`
      update crm.tasks set status = 'done', closed_reason = 'accepted', completed_at = now()
       where status = 'open' and id in (select task_id from crm.erp_quote_suggestions
                                        where entity = ${entity} and erp_customer_id = ${erpCustomerId} and company_id is null)`);
    await tx.execute(sql`delete from crm.erp_quote_suggestions where entity = ${entity} and erp_customer_id = ${erpCustomerId} and company_id is null and status = 'pending'`);
  });
  await refreshQuoteSuggestions();
}

/** Create the CRM company (and its main contact) from the ERP customer's details, linked straight away. */
export async function createCompanyFromErp(actor: Actor & { type: "user" }, entity: Entity, erpCustomerId: string): Promise<{ ok: true; companyId: string } | { ok: false; message: string }> {
  const c = await getErpCustomerDetail(entity, erpCustomerId);
  if (!c) return { ok: false, message: `That customer isn't in the ${entity} ERP (or was deleted).` };
  const companyId = await withActor(actor, async (tx) => {
    const [taken] = await rows<{ company_id: string }>(sql`select company_id from crm.company_erp_links where erp_entity = ${entity} and erp_customer_id = ${erpCustomerId}`, tx);
    if (taken) return taken.company_id;
    const email = c.email?.trim().toLowerCase() || null;
    const domain = email ? email.slice(email.indexOf("@") + 1) : null;
    const [free] = domain ? await rows<{ free: boolean }>(sql`select exists (select 1 from crm.free_email_domains where domain = ${domain}) as free`, tx) : [{ free: true }];
    const country = entity === "NZ" ? "NZ" : "AU";
    const [co] = await rows<{ id: string }>(
      sql`insert into crm.companies (name, domain, country_code, city, owner_id, source)
          values (${c.name}, ${domain && !free.free ? domain : null}, ${country}, ${c.billing_city}, ${actor.profileId}, 'erp')
          returning id`,
      tx,
    );
    await tx.execute(sql`
      insert into crm.company_erp_links (company_id, erp_entity, erp_customer_id, match_method, confidence, confirmed, confirmed_by, confirmed_at)
      values (${co.id}, ${entity}, ${erpCustomerId}, 'created_from_erp', 1, true, ${actor.profileId}, now())`);
    // The ERP's main contact, unless that email is already a CRM contact (then they're linked to this company if free).
    if (email || c.contact_name) {
      const [existing] = email ? await rows<{ id: string }>(sql`select id from crm.contacts where lower(email) = ${email} and deleted_at is null`, tx) : [];
      if (existing) await tx.execute(sql`update crm.contacts set company_id = coalesce(company_id, ${co.id}) where id = ${existing.id}`);
      else {
        const parts = (c.contact_name ?? "").trim().split(/\s+/).filter(Boolean);
        await tx.execute(sql`
          insert into crm.contacts (first_name, last_name, email, phone_raw, phone_e164, company_id, country_code, owner_id, source)
          values (${parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? null)}, ${parts.length > 1 ? parts.at(-1)! : null}, ${email},
                  ${c.phone}, crm.normalize_phone(${c.phone}, ${country}), ${co.id}, ${country}, ${actor.profileId}, 'erp')`);
      }
    }
    return co.id;
  });
  await settleCustomerLink(actor, entity, erpCustomerId);
  return { ok: true, companyId };
}
