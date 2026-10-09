import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import type { SpecifierStage } from "@/lib/labels";
import { companyDisplayName } from "./companies";

// The specifier track (phase 4.4, confirmed 9 Oct 2026): architects, designers and engineers the consultants visit
// follow a light track on the contact (Visited, Follow-up, Specified, Enquiry). A specifier becomes a deal only when a
// real enquiry arrives: "Create deal from specifier" opens a deal and moves them to Enquiry.

export type Visit = {
  id: string;
  visited_on: string;
  region: string | null;
  report_month: string | null;
  report_group: string | null;
  provided: string | null;
  action: string | null;
  follow_up_on: string | null;
  notes: string | null;
};

export async function listVisits(contactId: string): Promise<Visit[]> {
  return rows<Visit>(sql`
    select id, visited_on, region, report_month, report_group, provided, action, follow_up_on, notes
    from crm.visits where contact_id = ${contactId} order by visited_on desc, created_at desc limit 50`);
}

export async function setSpecifierStage(actor: Actor & { type: "user" }, contactId: string, stage: SpecifierStage | null): Promise<void> {
  await withActor(actor, (tx) =>
    tx.execute(sql`
      update crm.contacts
         set is_specifier = ${stage !== null}, specifier_stage = ${stage}::crm.specifier_stage
       where id = ${contactId} and deleted_at is null`),
  );
}

export type SpecifierRow = {
  id: string;
  name: string | null;
  email: string | null;
  company_id: string | null;
  company: string | null;
  role_title: string | null;
  city: string | null;
  stage: SpecifierStage | null;
  owner: string | null;
  visits: number;
  last_visit: string | null;
  last_region: string | null;
  follow_up_due: string | null; // earliest open follow-up
  last_activity_at: string | null;
};

/** Everyone on the specifier track, with their visits and any open follow-up. Set-based: one pass per table. */
export async function listSpecifiers(opts: { stage?: SpecifierStage; ownerId?: string } = {}): Promise<SpecifierRow[]> {
  return rows<SpecifierRow>(sql`
    with v as (
      select contact_id, count(*)::int as visits, max(visited_on) as last_visit,
             (array_agg(region order by visited_on desc))[1] as last_region
      from crm.visits group by contact_id
    ), f as (
      select contact_id, min(due_on) as due from crm.tasks
      where status = 'open' and contact_id is not null group by contact_id
    )
    select ct.id, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as name, ct.email,
           ct.company_id, ${companyDisplayName("co")} as company, ct.role_title, ct.city,
           ct.specifier_stage as stage, p.display_name as owner,
           coalesce(v.visits, 0) as visits, v.last_visit, v.last_region, f.due as follow_up_due, ct.last_activity_at
    from crm.contacts ct
    left join crm.companies co on co.id = ct.company_id and co.deleted_at is null
    left join crm.profiles p on p.id = ct.owner_id
    left join v on v.contact_id = ct.id
    left join f on f.contact_id = ct.id
    where ct.deleted_at is null and ct.is_specifier
      ${opts.stage ? sql`and ct.specifier_stage = ${opts.stage}::crm.specifier_stage` : sql``}
      ${opts.ownerId ? sql`and ct.owner_id = ${opts.ownerId}` : sql``}
    order by v.last_visit desc nulls last, name nulls last`);
}

export async function specifierCounts(): Promise<Record<string, number>> {
  const r = await rows<{ stage: string | null; n: number }>(sql`
    select specifier_stage::text as stage, count(*)::int as n from crm.contacts
    where deleted_at is null and is_specifier group by specifier_stage`);
  return Object.fromEntries(r.map((x) => [x.stage ?? "none", x.n]));
}
