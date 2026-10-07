// HubSpot notes export ("All notes"). Contacts appear as "First Last (email)"; the contact ids in this export do not
// match the contacts export, so the loader matches contacts by email first (approved 7 Oct 2026).

export const NOTE_COLUMNS = ["Record ID", "Body preview", "Associated Contact", "Associated Company", "Activity date", "Associated Contact IDs", "Associated Company IDs"] as const;

export type NoteRow = {
  record_id: string;
  body: string;
  activity_date: string;
  contact_emails: string[];
  contact_ids: string[];
  company_ids: string[];
  company_names: string[];
  contact_text: string;
  company_text: string;
};

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const list = (s: string | undefined) => (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);

export function emailsIn(s: string | undefined): string[] {
  return [...new Set([...(s ?? "").matchAll(EMAIL)].map((m) => m[0].toLowerCase()))];
}

export function mapHubspotNotes(table: string[][]): { rows: NoteRow[]; missing: string[] } {
  const [header = [], ...body] = table;
  const cols = header.map((h) => h.replace(/^﻿/, "").trim());
  const missing = NOTE_COLUMNS.filter((c) => !cols.includes(c));
  if (missing.length) return { rows: [], missing };
  const at = (cells: string[], c: (typeof NOTE_COLUMNS)[number]) => (cells[cols.indexOf(c)] ?? "").trim();

  const rows = body
    .filter((cells) => cells.some((c) => c.trim()))
    .map((cells) => ({
      record_id: at(cells, "Record ID"),
      body: at(cells, "Body preview").slice(0, 10000),
      activity_date: at(cells, "Activity date"),
      contact_emails: emailsIn(at(cells, "Associated Contact")),
      contact_ids: list(at(cells, "Associated Contact IDs")),
      company_ids: list(at(cells, "Associated Company IDs")),
      company_names: list(at(cells, "Associated Company")),
      contact_text: at(cells, "Associated Contact").slice(0, 500),
      company_text: at(cells, "Associated Company").slice(0, 500),
    }))
    .filter((r) => r.record_id);
  return { rows, missing: [] };
}
