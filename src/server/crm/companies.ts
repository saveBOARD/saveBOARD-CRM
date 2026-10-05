import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import type { Segment } from "@/lib/labels";

// Companies: organisations, prospects and customers (brief: CRM data model).

/**
 * Display name. 508 HubSpot companies came through with their HubSpot id as the name (no name in HubSpot);
 * show their domain until the companies export brings real names (phase 2.7).
 */
export const companyDisplayName = (alias: string) =>
  sql.raw(`case when ${alias}.name ~ '^[0-9]+$' and ${alias}.domain is not null then ${alias}.domain else ${alias}.name end`);

export type CompanyListRow = {
  id: string;
  name: string;
  domain: string | null;
  segment: Segment;
  country_code: string | null;
  owner_id: string | null;
  owner: string | null;
  erp: string | null; // "NZ", "AUS", "AUS + NZ"
  contacts: number;
  open_deals: number;
  last_activity_at: string | null; // timestamptz as Postgres text (Drizzle returns timestamps as text)
};

export async function listCompanies(): Promise<CompanyListRow[]> {
  return rows<CompanyListRow>(sql`
    select c.id, ${companyDisplayName("c")} as name, c.domain, c.segment, c.country_code,
           c.owner_id, p.display_name as owner,
           (select string_agg(l.erp_entity, ' + ' order by l.erp_entity)
              from crm.company_erp_links l where l.company_id = c.id and l.confirmed) as erp,
           (select count(*)::int from crm.contacts ct where ct.company_id = c.id and ct.deleted_at is null) as contacts,
           (select count(*)::int from crm.deals d
             where d.company_id = c.id and d.deleted_at is null and d.stage not in ('won', 'lost')) as open_deals,
           c.last_activity_at
    from crm.companies c
    left join crm.profiles p on p.id = c.owner_id
    where c.deleted_at is null
    order by c.last_activity_at desc nulls last, name`);
}

export type Company = {
  id: string;
  name: string;
  raw_name: string;
  domain: string | null;
  website: string | null;
  country_code: string | null;
  city: string | null;
  segment: Segment;
  owner_id: string | null;
  owner: string | null;
  source: string | null;
  notes: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
  last_activity_at: string | null; // timestamptz as Postgres text (Drizzle returns timestamps as text)
  hubspot_id: string | null;
  created_at: string; // timestamptz as Postgres text
};

export async function getCompany(id: string): Promise<Company | null> {
  const [c] = await rows<Company>(sql`
    select c.id, ${companyDisplayName("c")} as name, c.name as raw_name, c.domain, c.website, c.country_code, c.city,
           c.segment, c.owner_id, p.display_name as owner, c.source, c.notes, c.snoozed_until, c.snooze_reason,
           c.last_activity_at, c.hubspot_id, c.created_at
    from crm.companies c
    left join crm.profiles p on p.id = c.owner_id
    where c.id = ${id} and c.deleted_at is null`);
  return c ?? null;
}
