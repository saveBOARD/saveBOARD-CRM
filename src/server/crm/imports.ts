import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { HUBSPOT_CONTACT_COLUMNS } from "@/lib/hubspot-contacts";

// HubSpot imports from the Imports screen (admins). Rows go straight to the database: nothing is written to disk.

const cell = z.string().max(2000);
export const contactRowsSchema = z
  .array(z.object(Object.fromEntries(Object.values(HUBSPOT_CONTACT_COLUMNS).map((k) => [k, cell])) as Record<string, typeof cell>).strict())
  .min(1, "The file has no contacts")
  .max(50000, "Too many rows: split the file");

export type ImportResult = {
  batch: string;
  rows_read: number;
  contacts_created: number;
  contacts_updated: number;
  contacts_skipped: number;
  companies_created: number;
  companies_updated: number;
  report: { measure: string; n: number }[];
};

export async function importHubspotContacts(profileId: string, fileName: string, data: unknown): Promise<ImportResult> {
  const parsed = contactRowsSchema.parse(data);
  return withActor({ type: "user", profileId }, async (tx) => {
    const [r] = await rows<{ result: ImportResult }>(
      sql`select crm_staging.import_hubspot_contacts(${JSON.stringify(parsed)}::jsonb, ${fileName.slice(0, 200)}, ${profileId}) as result`,
      tx,
    );
    return r.result;
  });
}

export type ImportBatch = {
  id: string;
  kind: string;
  file_name: string | null;
  rows_read: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  rows_error: number;
  started_at: string;
  finished_at: string | null;
  created_by: string | null;
  details: {
    contacts_created?: number;
    contacts_updated?: number;
    companies_created?: number;
    companies_updated?: number;
    notes_created?: number;
    notes_updated?: number;
    suppression_list?: number;
    contacts_unsubscribed?: number;
    contacts_bounced?: number;
    visits?: number; // consultant visit reports
    follow_ups?: number;
  } | null;
};

export async function listImportBatches(limit = 50): Promise<ImportBatch[]> {
  return rows<ImportBatch>(sql`
    select b.id, b.kind, b.file_name, b.rows_read, b.rows_created, b.rows_updated, b.rows_skipped, b.rows_error,
           b.started_at, b.finished_at, p.display_name as created_by, b.details
    from crm.import_batches b
    left join crm.profiles p on p.id = b.created_by
    order by b.started_at desc
    limit ${limit}`);
}

// --- Email campaign results -> suppression list and contact consent --------------------------------------------

const suppressionsSchema = z
  .array(
    z
      .object({
        email: z.string().max(320).regex(/^[^@\s]+@[^@\s]+$/),
        status: z.enum(["unsubscribed", "bounced"]),
        reason: z.string().max(100),
        occurred_at: z.string().max(40),
      })
      .strict(),
  )
  .max(100000);
const statsSchema = z
  .object({ files: z.number(), rows: z.number(), recipients: z.number(), unsubscribed: z.number(), bounced: z.number(), soft_only: z.number() })
  .strict();

export type EmailEventsResult = {
  batch: string;
  suppression_list: number;
  contacts_unsubscribed: number;
  contacts_bounced: number;
  list_total: number;
  contacts_now_unsubscribed: number;
  contacts_now_bounced: number;
};

export async function importEmailEvents(profileId: string, fileNames: string, suppressions: unknown, stats: unknown): Promise<EmailEventsResult> {
  const rowsIn = suppressionsSchema.parse(suppressions);
  const s = statsSchema.parse(stats);
  return withActor({ type: "user", profileId }, async (tx) => {
    const [r] = await rows<{ result: EmailEventsResult }>(
      sql`select crm_staging.import_hubspot_email_events(${JSON.stringify(rowsIn)}::jsonb, ${JSON.stringify(s)}::jsonb,
                                                         ${fileNames.slice(0, 500)}, ${profileId}) as result`,
      tx,
    );
    return r.result;
  });
}

// --- Notes -> note activities ------------------------------------------------------------------------------------

const ids = z.array(z.string().max(320)).max(200);
const notesSchema = z
  .array(
    z
      .object({
        record_id: z.string().min(1).max(40),
        body: z.string().max(10000),
        activity_date: z.string().max(40),
        contact_emails: ids,
        contact_ids: ids,
        company_ids: ids,
        company_names: ids,
        contact_text: z.string().max(500),
        company_text: z.string().max(500),
      })
      .strict(),
  )
  .min(1, "The file has no notes")
  .max(50000);

export type NotesResult = {
  batch: string;
  rows_read: number;
  notes_created: number;
  notes_updated: number;
  linked_to_contact: number;
  company_only: number;
  not_linked: number;
};

export async function importNotes(profileId: string, fileName: string, data: unknown): Promise<NotesResult> {
  const parsed = notesSchema.parse(data);
  return withActor({ type: "user", profileId }, async (tx) => {
    const [r] = await rows<{ result: NotesResult }>(
      sql`select crm_staging.import_hubspot_notes(${JSON.stringify(parsed)}::jsonb, ${fileName.slice(0, 200)}, ${profileId}) as result`,
      tx,
    );
    return r.result;
  });
}

export type UnlinkedNote = { id: string; occurred_at: string; summary: string | null; hubspot_contact: string | null; hubspot_company: string | null };

/** HubSpot notes that matched no contact or company (most were probably on HubSpot deals, which weren't exported). */
export async function listUnlinkedHubspotNotes(): Promise<UnlinkedNote[]> {
  return rows<UnlinkedNote>(sql`
    select id, occurred_at, summary, metadata->>'hubspot_contact' as hubspot_contact, metadata->>'hubspot_company' as hubspot_company
    from crm.activities
    where origin = 'hubspot' and type = 'note' and contact_id is null and company_id is null and deal_id is null
    order by occurred_at desc`);
}
