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
  details: { contacts_created?: number; contacts_updated?: number; companies_created?: number; companies_updated?: number } | null;
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
