import "server-only";
import { sql } from "drizzle-orm";
import { erpRead } from "./read";
import type { Entity } from "./company";

// Suggested company -> ERP customer links waiting for a person to accept or reject (nothing links by itself).

export type MatchCandidate = {
  id: string;
  method: "name_exact" | "email" | "domain" | "name_fuzzy" | string;
  score: string;
  company_id: string;
  company: string;
  company_domain: string | null;
  company_country: string | null;
  company_contacts: number;
  erp_entity: Entity;
  erp_customer_id: string;
  erp_name: string | null;
  erp_code: string | null;
  erp_email: string | null;
  erp_city: string | null;
  erp_active: boolean | null;
  /** The ERP customer is already linked to another CRM company (accepting would clash). */
  taken_by_company_id: string | null;
  taken_by_company: string | null;
};

export async function listMatchCandidates(): Promise<MatchCandidate[]> {
  return erpRead<MatchCandidate>(sql`
    select m.id, m.method, m.score,
           co.id as company_id,
           case when co.name ~ '^[0-9]+$' and co.domain is not null then co.domain else co.name end as company,
           co.domain as company_domain, co.country_code as company_country,
           (select count(*)::int from crm.contacts ct where ct.company_id = co.id and ct.deleted_at is null) as company_contacts,
           m.erp_entity, m.erp_customer_id,
           coalesce(c.name, m.erp_customer_name) as erp_name, c.code as erp_code, c.email as erp_email,
           c.billing_city as erp_city, c.active as erp_active,
           tl.company_id as taken_by_company_id, tco.name as taken_by_company
    from crm.erp_match_candidates m
    join crm.companies co on co.id = m.company_id and co.deleted_at is null
    left join erp_read.customers c on c.id = m.erp_customer_id and c.entity_id = m.erp_entity
    left join crm.company_erp_links tl on tl.erp_entity = m.erp_entity and tl.erp_customer_id = m.erp_customer_id
                                      and tl.company_id <> m.company_id
    left join crm.companies tco on tco.id = tl.company_id
    where m.status = 'pending'
      -- skip suggestions the company already has a confirmed link for, in that entity
      and not exists (select 1 from crm.company_erp_links l
                      where l.company_id = m.company_id and l.erp_entity = m.erp_entity and l.confirmed)
    order by m.score desc, company`);
}
