import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";

// Linking CRM companies to ERP customers (brief: matching rules). Always by ERP customer id + entity, never by
// name, and always confirmed by a person. A company can have one link per entity (NZ and AUS).

/** Run the matcher (crm.suggest_erp_matches): adds or refreshes pending suggestions. Returns how many. */
export async function suggestMatches(actor: Actor): Promise<number> {
  return withActor(actor, async (tx) => {
    const [r] = await rows<{ n: number }>(sql`select crm.suggest_erp_matches() as n`, tx);
    return r.n;
  });
}

/** Accept a suggestion. Refused (false) if that ERP customer is already linked to a different company. */
export async function acceptMatch(actor: Actor & { type: "user" }, candidateId: string): Promise<boolean> {
  return withActor(actor, async (tx) => {
    const [clash] = await rows<{ n: number }>(
      sql`select count(*)::int as n from crm.erp_match_candidates m
          join crm.company_erp_links l on l.erp_entity = m.erp_entity and l.erp_customer_id = m.erp_customer_id
          where m.id = ${candidateId} and l.company_id <> m.company_id`,
      tx,
    );
    if (clash.n > 0) return false;
    await tx.execute(sql`select crm.accept_erp_match(${candidateId}, ${actor.profileId})`);
    return true;
  });
}

export async function rejectMatch(actor: Actor & { type: "user" }, candidateId: string): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`
      update crm.erp_match_candidates
         set status = 'rejected', reviewed_by = ${actor.profileId}, reviewed_at = now()
       where id = ${candidateId} and status = 'pending'`),
  );
}

export type LinkResult = { ok: true } | { ok: false; reason: string };

/** Link by hand, after the caller has checked the ERP customer exists in that entity. */
export async function linkCompany(
  actor: Actor & { type: "user" },
  companyId: string,
  entity: "NZ" | "AUS",
  erpCustomerId: string,
): Promise<LinkResult> {
  return withActor(actor, async (tx) => {
    const [taken] = await rows<{ company_id: string }>(
      sql`select company_id from crm.company_erp_links where erp_entity = ${entity} and erp_customer_id = ${erpCustomerId}`,
      tx,
    );
    if (taken && taken.company_id !== companyId) return { ok: false, reason: "That ERP customer is already linked to another company." };
    await tx.execute(sql`
      insert into crm.company_erp_links (company_id, erp_entity, erp_customer_id, match_method, confidence, confirmed, confirmed_by, confirmed_at)
      values (${companyId}, ${entity}, ${erpCustomerId}, 'manual', 1, true, ${actor.profileId}, now())
      on conflict (company_id, erp_entity) do update
         set erp_customer_id = excluded.erp_customer_id, match_method = 'manual', confidence = 1,
             confirmed = true, confirmed_by = excluded.confirmed_by, confirmed_at = now()`);
    // Any other suggestions for this company and entity are now settled.
    await tx.execute(sql`
      update crm.erp_match_candidates set status = 'rejected', reviewed_by = ${actor.profileId}, reviewed_at = now()
       where company_id = ${companyId} and erp_entity = ${entity} and status = 'pending' and erp_customer_id <> ${erpCustomerId}`);
    await tx.execute(sql`
      update crm.erp_match_candidates set status = 'accepted', reviewed_by = ${actor.profileId}, reviewed_at = now()
       where company_id = ${companyId} and erp_entity = ${entity} and status = 'pending' and erp_customer_id = ${erpCustomerId}`);
    return { ok: true };
  });
}

/** Remove a link (admins). The ERP is not touched. */
export async function unlinkCompany(actor: Actor & { type: "user" }, companyId: string, entity: "NZ" | "AUS"): Promise<void> {
  await withActor(actor, (tx) => tx.execute(sql`delete from crm.company_erp_links where company_id = ${companyId} and erp_entity = ${entity}`));
}

export async function pendingMatchCount(): Promise<number> {
  const [r] = await rows<{ n: number }>(sql`
    select count(*)::int as n from crm.erp_match_candidates m
    join crm.companies co on co.id = m.company_id and co.deleted_at is null
    where m.status = 'pending'
      and not exists (select 1 from crm.company_erp_links l
                      where l.company_id = m.company_id and l.erp_entity = m.erp_entity and l.confirmed)`);
  return r.n;
}
