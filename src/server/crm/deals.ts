import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import type { Stage } from "@/lib/labels";
import { companyDisplayName } from "./companies";
import type { DealInput } from "./schemas";

// Deals: opportunities on the one pipeline (brief: Pipeline and automatic deal movement).
// Until ERP sync arrives (build phase 5), people move deals between stages by hand, including to Won.

const contactName = sql.raw(`nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '')`);

export type DealListRow = {
  id: string;
  title: string;
  stage: Stage;
  entity: "NZ" | "AUS" | null;
  est_value: string | null;
  est_currency: "NZD" | "AUD" | null;
  owner: string | null;
  next_action_on: string | null;
  last_activity_at: string | null; // timestamptz as Postgres text (Drizzle returns timestamps as text)
};

export async function listDealsFor(scope: { companyId: string } | { contactId: string }): Promise<DealListRow[]> {
  const where = "companyId" in scope ? sql`d.company_id = ${scope.companyId}` : sql`d.primary_contact_id = ${scope.contactId}`;
  return rows<DealListRow>(sql`
    select d.id, d.title, d.stage, d.entity, d.est_value, d.est_currency, p.display_name as owner,
           d.next_action_on, d.last_activity_at
    from crm.deals d
    left join crm.profiles p on p.id = d.owner_id
    where d.deleted_at is null and ${where}
    order by (d.stage in ('won', 'lost')), d.updated_at desc`);
}

export type BoardDeal = DealListRow & {
  company_id: string | null;
  company: string | null;
  contact: string | null;
  owner_id: string | null;
  next_action: string | null;
  snoozed_until: string | null;
  erp_so_number: string | null;
  days_quiet: number | null;
  stage_changed_at: string;
};

/** Deals for the board. Won and Lost only from the last 90 days, so the board stays about open work. */
export async function listBoardDeals(filters: { ownerId?: string; entity?: "NZ" | "AUS" } = {}): Promise<BoardDeal[]> {
  return rows<BoardDeal>(sql`
    select d.id, d.title, d.stage, d.entity, d.est_value, d.est_currency, d.owner_id, p.display_name as owner,
           d.company_id, ${companyDisplayName("co")} as company, ${contactName} as contact,
           d.next_action, d.next_action_on, d.snoozed_until, d.erp_so_number, d.last_activity_at, d.stage_changed_at,
           extract(day from now() - coalesce(d.last_activity_at, d.created_at))::int as days_quiet
    from crm.deals d
    left join crm.companies co on co.id = d.company_id
    left join crm.contacts ct on ct.id = d.primary_contact_id
    left join crm.profiles p on p.id = d.owner_id
    where d.deleted_at is null
      and (d.stage not in ('won', 'lost') or d.closed_at > now() - interval '90 days')
      ${filters.ownerId ? sql`and d.owner_id = ${filters.ownerId}` : sql``}
      ${filters.entity ? sql`and d.entity = ${filters.entity}` : sql``}
    order by d.next_action_on nulls last, d.updated_at desc`);
}

export type Deal = BoardDeal & {
  primary_contact_id: string | null;
  source: string | null;
  snooze_reason: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  erp_status: string | null;
  erp_quote_status: string | null;
  erp_total: string | null;
  erp_currency: string | null;
  erp_quote_expires_on: string | null;
  erp_synced_at: string | null;
  hubspot_id: string | null;
  created_at: string;
};

export async function getDeal(id: string): Promise<Deal | null> {
  const [d] = await rows<Deal>(sql`
    select d.id, d.title, d.stage, d.entity, d.est_value, d.est_currency, d.owner_id, p.display_name as owner,
           d.company_id, ${companyDisplayName("co")} as company, d.primary_contact_id, ${contactName} as contact,
           d.next_action, d.next_action_on, d.snoozed_until, d.snooze_reason, d.erp_so_number, d.last_activity_at,
           d.stage_changed_at, d.source, d.lost_reason, d.closed_at, d.erp_status, d.erp_quote_status, d.erp_total,
           d.erp_currency, d.erp_quote_expires_on, d.erp_synced_at, d.hubspot_id, d.created_at,
           extract(day from now() - coalesce(d.last_activity_at, d.created_at))::int as days_quiet
    from crm.deals d
    left join crm.companies co on co.id = d.company_id
    left join crm.contacts ct on ct.id = d.primary_contact_id
    left join crm.profiles p on p.id = d.owner_id
    where d.id = ${id} and d.deleted_at is null`);
  return d ?? null;
}

export type StageChange = { id: string; from_stage: Stage | null; to_stage: Stage; reason: string; changed_by: string | null; changed_at: string };

export async function listStageHistory(dealId: string): Promise<StageChange[]> {
  return rows<StageChange>(sql`
    select h.id::text as id, h.from_stage, h.to_stage, h.reason, p.display_name as changed_by, h.changed_at
    from crm.deal_stage_history h
    left join crm.profiles p on p.id = h.changed_by
    where h.deal_id = ${dealId}
    order by h.changed_at desc, h.id desc`);
}

const CURRENCY = { NZ: "NZD", AUS: "AUD" } as const;

/** Another deal already using this ERP quote number in this entity. */
export async function findDealByErpNumber(entity: "NZ" | "AUS", soNumber: string, excludeId?: string) {
  const [d] = await rows<{ id: string; title: string }>(sql`
    select id, title from crm.deals
    where entity = ${entity} and upper(erp_so_number) = upper(${soNumber}) and deleted_at is null
      ${excludeId ? sql`and id <> ${excludeId}` : sql``}`);
  return d ?? null;
}

export async function createDeal(actor: Actor, d: DealInput & { stage?: Stage }): Promise<string> {
  return withActor(actor, async (tx) => {
    const [r] = await rows<{ id: string }>(
      sql`insert into crm.deals (title, company_id, primary_contact_id, entity, est_currency, est_value, source, owner_id,
                                 next_action, next_action_on, erp_so_number, stage)
          values (${d.title}, ${d.company_id}, ${d.primary_contact_id}, ${d.entity}, ${CURRENCY[d.entity]}, ${d.est_value},
                  ${d.source}, ${d.owner_id}, ${d.next_action}, ${d.next_action_on}, ${d.erp_so_number}, ${d.stage ?? "new_enquiry"})
          returning id`,
      tx,
    );
    return r.id;
  });
}

export async function updateDeal(actor: Actor, id: string, d: DealInput): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`
      update crm.deals
         set title = ${d.title}, company_id = ${d.company_id}, primary_contact_id = ${d.primary_contact_id},
             entity = ${d.entity}, est_currency = ${CURRENCY[d.entity]}, est_value = ${d.est_value}, source = ${d.source},
             owner_id = ${d.owner_id}, next_action = ${d.next_action}, next_action_on = ${d.next_action_on},
             erp_so_number = ${d.erp_so_number}
       where id = ${id} and deleted_at is null`),
  );
}

/**
 * Move a deal to another stage by hand. Lost needs a reason (checked by the caller); moving out of Lost
 * clears it. The stage-history trigger records the move with the user and reason 'manual'.
 */
export async function moveDeal(actor: Actor, id: string, stage: Stage, lostReason: string | null): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`
      update crm.deals
         set stage = ${stage}::crm.deal_stage,
             lost_reason = ${stage === "lost" ? lostReason : null}
       where id = ${id} and deleted_at is null and stage is distinct from ${stage}::crm.deal_stage`),
  );
}

/** Snooze until a date with a reason (hides it from the chase list), or wake it with until = null. */
export async function snoozeDeal(actor: Actor, id: string, until: string | null, reason: string | null): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`update crm.deals set snoozed_until = ${until}, snooze_reason = ${until ? reason : null} where id = ${id} and deleted_at is null`),
  );
}
