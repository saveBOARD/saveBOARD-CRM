// The HubSpot contacts export ("All contacts" view), mapped by column NAME to the staging columns the loader reads
// (crm_staging.hubspot_contacts, migration 4). Column order in the file does not matter; extra columns are ignored.

export const HUBSPOT_CONTACT_COLUMNS = {
  "Record ID": "record_id",
  "First Name": "first_name",
  "Last Name": "last_name",
  Email: "email",
  "Phone Number": "phone_number",
  City: "city",
  "Company Style": "company_style",
  "Associated Company (Primary)": "associated_company",
  "Samples Sent": "samples_sent",
  "Country/Region": "country_region",
  "Contact owner": "contact_owner",
  "Last Activity Date": "last_activity_date",
  "Associated Company IDs (Primary)": "associated_company_id",
} as const;

export type StagingKey = (typeof HUBSPOT_CONTACT_COLUMNS)[keyof typeof HUBSPOT_CONTACT_COLUMNS];
export type HubspotContactRow = Record<StagingKey, string>;

export type MappedFile = { rows: HubspotContactRow[]; missing: string[]; ignored: string[] };

/** Turn the parsed CSV (first row = headers) into staging rows. Blank lines are skipped. */
export function mapHubspotContacts(table: string[][]): MappedFile {
  const [header = [], ...body] = table;
  const clean = header.map((h) => h.replace(/^﻿/, "").trim());
  const index = new Map(clean.map((h, i) => [h, i]));
  const expected = Object.keys(HUBSPOT_CONTACT_COLUMNS) as (keyof typeof HUBSPOT_CONTACT_COLUMNS)[];
  const missing = expected.filter((h) => !index.has(h));
  const ignored = clean.filter((h) => h && !(h in HUBSPOT_CONTACT_COLUMNS));
  if (missing.length > 0) return { rows: [], missing, ignored };

  const rows = body
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(expected.map((h) => [HUBSPOT_CONTACT_COLUMNS[h], (r[index.get(h)!] ?? "").trim()])) as HubspotContactRow);
  return { rows, missing, ignored };
}
