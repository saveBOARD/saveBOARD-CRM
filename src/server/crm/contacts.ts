import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import type { Consent, Segment } from "@/lib/labels";
import { companyDisplayName } from "./companies";

// Contacts: people (and generic mailboxes such as info@) at companies.

export type ContactListRow = {
  id: string;
  name: string | null;
  email: string | null;
  kind: "person" | "generic_mailbox";
  company_id: string | null;
  company: string | null;
  phone: string | null;
  country_code: string | null;
  segment: Segment;
  samples_sent: boolean;
  owner_id: string | null;
  owner: string | null;
  consent_status: Consent;
  last_activity_at: string | null; // timestamptz as Postgres text (Drizzle returns timestamps as text)
};

const contactName = sql.raw(`nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '')`);

export async function listContacts(opts: { ownerId?: string; companyId?: string } = {}): Promise<ContactListRow[]> {
  return rows<ContactListRow>(sql`
    select ct.id, ${contactName} as name, ct.email, ct.kind,
           ct.company_id, ${companyDisplayName("co")} as company,
           coalesce(ct.phone_e164, ct.phone_raw) as phone, ct.country_code, ct.segment, ct.samples_sent,
           ct.owner_id, p.display_name as owner, ct.consent_status, ct.last_activity_at
    from crm.contacts ct
    left join crm.companies co on co.id = ct.company_id and co.deleted_at is null
    left join crm.profiles p on p.id = ct.owner_id
    where ct.deleted_at is null
      ${opts.ownerId ? sql`and ct.owner_id = ${opts.ownerId}` : sql``}
      ${opts.companyId ? sql`and ct.company_id = ${opts.companyId}` : sql``}
    order by ct.last_activity_at desc nulls last, name nulls last, ct.email`);
}

export type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  phone_raw: string | null;
  city: string | null;
  country_code: string | null;
  role_title: string | null;
  kind: "person" | "generic_mailbox";
  segment: Segment;
  samples_sent: boolean;
  track_followup: boolean;
  owner_id: string | null;
  owner: string | null;
  company_id: string | null;
  company: string | null;
  source: string | null;
  consent_status: Consent;
  consent_source: string | null;
  consent_at: string | null; // timestamptz as Postgres text (Drizzle returns timestamps as text)
  notes: string | null;
  last_activity_at: string | null; // timestamptz as Postgres text (Drizzle returns timestamps as text)
  hubspot_id: string | null;
  created_at: string; // timestamptz as Postgres text
};

export async function getContact(id: string): Promise<Contact | null> {
  const [c] = await rows<Contact>(sql`
    select ct.id, ct.first_name, ct.last_name, ${contactName} as name, ct.email, ct.phone_e164, ct.phone_raw,
           ct.city, ct.country_code, ct.role_title, ct.kind, ct.segment, ct.samples_sent, ct.track_followup,
           ct.owner_id, p.display_name as owner, ct.company_id, ${companyDisplayName("co")} as company,
           ct.source, ct.consent_status, ct.consent_source, ct.consent_at, ct.notes, ct.last_activity_at,
           ct.hubspot_id, ct.created_at
    from crm.contacts ct
    left join crm.companies co on co.id = ct.company_id and co.deleted_at is null
    left join crm.profiles p on p.id = ct.owner_id
    where ct.id = ${id} and ct.deleted_at is null`);
  return c ?? null;
}
