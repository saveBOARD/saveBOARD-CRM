import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import type { Stage } from "@/lib/labels";

// Deals: opportunities on the one pipeline (brief: Pipeline and automatic deal movement).

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
