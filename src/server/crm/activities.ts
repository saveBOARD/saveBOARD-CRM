import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import type { ActivityType } from "@/lib/labels";

// The single activity timeline: emails, calls, notes, visits and system events (brief: CRM data model).

export type Activity = {
  id: string;
  type: ActivityType;
  direction: "inbound" | "outbound" | "internal";
  subject: string | null;
  summary: string | null;
  occurred_at: string; // timestamptz as Postgres text
  origin: string;
  external_url: string | null;
  /** From Claude's email summary (phase 3.3). */
  next_step: string | null;
  follow_up_on: string | null;
  summary_status: string | null;
  summary_error: string | null;
  owner: string | null;
  contact_id: string | null;
  contact: string | null;
  deal_id: string | null;
  deal: string | null;
};

type Scope = { companyId: string } | { contactId: string } | { dealId: string };

/** Newest first. For a company this includes activities on its contacts and deals. */
export async function listActivities(scope: Scope, limit = 100): Promise<Activity[]> {
  const where =
    "companyId" in scope
      ? sql`(a.company_id = ${scope.companyId}
             or a.contact_id in (select id from crm.contacts where company_id = ${scope.companyId})
             or a.deal_id in (select id from crm.deals where company_id = ${scope.companyId}))`
      : "contactId" in scope
        ? sql`a.contact_id = ${scope.contactId}`
        : sql`a.deal_id = ${scope.dealId}`;

  return rows<Activity>(sql`
    select a.id, a.type, a.direction, a.subject, a.summary, a.occurred_at, a.origin, a.external_url,
           a.metadata ->> 'next_step' as next_step, a.metadata ->> 'follow_up_on' as follow_up_on,
           a.metadata ->> 'summary_status' as summary_status, a.metadata ->> 'summary_error' as summary_error,
           p.display_name as owner,
           a.contact_id, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact,
           a.deal_id, d.title as deal
    from crm.activities a
    left join crm.profiles p on p.id = a.owner_id
    left join crm.contacts ct on ct.id = a.contact_id
    left join crm.deals d on d.id = a.deal_id
    where ${where}
    order by a.occurred_at desc
    limit ${limit}`);
}
