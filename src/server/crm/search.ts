import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import type { Stage } from "@/lib/labels";
import { companyDisplayName } from "./companies";

// Top-bar search across companies, contacts and deals. Plain "contains" matching is plenty at this scale
// (about 4,000 companies and 6,000 contacts); results that START with the text come first.

const LIMIT = 15;

/** Escape LIKE wildcards so "%" and "_" in the search text are plain characters. */
const likeText = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export type SearchResults = {
  companies: { id: string; name: string; domain: string | null; country_code: string | null; contacts: number }[];
  contacts: { id: string; name: string; email: string | null; phone: string | null; company: string | null; company_id: string | null }[];
  deals: { id: string; title: string; stage: Stage; company: string | null; erp_so_number: string | null; est_value: string | null; est_currency: string | null }[];
};

export async function searchAll(q: string): Promise<SearchResults> {
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return { companies: [], contacts: [], deals: [] };
  const like = `%${likeText(term)}%`;
  const starts = `${likeText(term)}%`;
  // Phone numbers: compare digits only, and also without a leading 0 so "021 555" finds "+6421555...".
  const digits = term.replace(/\D/g, "");
  const phoneDigits = digits.length >= 5 ? `%${digits.replace(/^0+/, "")}%` : null;

  const [companies, contacts, deals] = await Promise.all([
    rows<SearchResults["companies"][number]>(sql`
      select c.id, ${companyDisplayName("c")} as name, c.domain, c.country_code,
             (select count(*)::int from crm.contacts ct where ct.company_id = c.id and ct.deleted_at is null) as contacts
      from crm.companies c
      where c.deleted_at is null and (c.name ilike ${like} or c.domain ilike ${like})
      order by (c.name ilike ${starts} or c.domain ilike ${starts}) desc, c.last_activity_at desc nulls last, c.name
      limit ${LIMIT}`),
    rows<SearchResults["contacts"][number]>(sql`
      select ct.id,
             coalesce(nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), ''), ct.email, '(no name)') as name,
             ct.email, coalesce(ct.phone_e164, ct.phone_raw) as phone,
             ${companyDisplayName("co")} as company, ct.company_id
      from crm.contacts ct
      left join crm.companies co on co.id = ct.company_id and co.deleted_at is null
      where ct.deleted_at is null
        and (concat_ws(' ', ct.first_name, ct.last_name) ilike ${like}
             or ct.email ilike ${like}
             ${phoneDigits ? sql`or regexp_replace(coalesce(ct.phone_e164, ct.phone_raw, ''), '[^0-9]', '', 'g') like ${phoneDigits}` : sql``})
      order by (concat_ws(' ', ct.first_name, ct.last_name) ilike ${starts} or ct.email ilike ${starts}) desc,
               ct.last_activity_at desc nulls last
      limit ${LIMIT}`),
    rows<SearchResults["deals"][number]>(sql`
      select d.id, d.title, d.stage, ${companyDisplayName("co")} as company, d.erp_so_number, d.est_value, d.est_currency
      from crm.deals d
      left join crm.companies co on co.id = d.company_id
      where d.deleted_at is null and (d.title ilike ${like} or d.erp_so_number ilike ${like})
      order by (d.stage in ('won', 'lost')), d.updated_at desc
      limit ${LIMIT}`),
  ]);
  return { companies, contacts, deals };
}
