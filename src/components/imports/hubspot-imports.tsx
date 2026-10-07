"use client";

import { importEmailEventsAction, importNotesAction } from "@/app/(app)/import-actions";
import { classifyEmailEvents, type Suppression } from "@/lib/hubspot-email-events";
import { mapHubspotNotes, type NoteRow } from "@/lib/hubspot-notes";
import { CsvImport } from "./csv-import";

const n = (x: number) => x.toLocaleString("en-NZ");

export function NotesImport() {
  return (
    <CsvImport
      chooseLabel="Choose notes CSV"
      help="From HubSpot: Notes export, CSV. Loading again updates notes instead of duplicating them."
      prepare={(files) => {
        const f = files[0];
        const m = mapHubspotNotes(f.table);
        if (m.missing.length) return { problem: `This isn't the HubSpot notes export: missing column(s) ${m.missing.join(", ")}.` };
        if (m.rows.length === 0) return { problem: "The file has no notes." };
        return {
          label: f.name,
          summary: `${n(m.rows.length)} notes found. They are linked to contacts by email, then to companies; the rest are kept as "not linked".`,
          preview: {
            headers: ["Date", "Note", "Contact", "Company"],
            rows: m.rows.slice(0, 5).map((r) => [r.activity_date, r.body.slice(0, 140) + (r.body.length > 140 ? "…" : ""), r.contact_text, r.company_text]),
          },
          payload: m.rows,
          loadLabel: `Load ${n(m.rows.length)} notes`,
        };
      }}
      load={async (p) => {
        const r = await importNotesAction(p.label, p.payload as NoteRow[]);
        if (!r.ok) return r;
        const x = r.result;
        return {
          ok: true,
          lines: [
            `Loaded ${n(x.rows_read)} notes: ${n(x.notes_created)} added, ${n(x.notes_updated)} updated.`,
            `${n(x.linked_to_contact)} on a contact's timeline, ${n(x.company_only)} on a company only, ${n(x.not_linked)} not linked (listed below).`,
          ],
        };
      }}
    />
  );
}

export function EmailEventsImport() {
  return (
    <CsvImport
      multiple
      chooseLabel="Choose campaign result CSVs"
      help="From HubSpot: each email's Recipients export. Choose all the files at once."
      prepare={(files) => {
        const c = classifyEmailEvents(files);
        if (c.missing.length === files.length) {
          return { problem: `These aren't HubSpot email campaign results: ${c.missing.map((m) => `${m.file} is missing ${m.columns.join(", ")}`).join("; ")}.` };
        }
        const skipped = c.missing.length ? ` Skipped (not campaign results): ${c.missing.map((m) => m.file).join(", ")}.` : "";
        const s = c.stats;
        return {
          label: `${s.files} campaign file(s)`,
          summary:
            `${n(s.rows)} sends to ${n(s.recipients)} people. Unsubscribed: ${n(s.unsubscribed)}. Bounced (permanent): ${n(s.bounced)}. ` +
            `Temporary or filter bounces, left as unknown: ${n(s.soft_only)}. Nobody is marked as subscribed.${skipped}`,
          preview: {
            headers: ["Email", "Becomes", "Why"],
            rows: c.suppressions.slice(0, 5).map((x) => [x.email, x.status === "unsubscribed" ? "Unsubscribed" : "Bounced", x.reason]),
          },
          payload: { suppressions: c.suppressions, stats: s, files: files.filter((f) => !c.missing.some((m) => m.file === f.name)).map((f) => f.name).join(", ") },
          loadLabel: `Apply ${n(c.suppressions.length)} unsubscribes and bounces`,
        };
      }}
      load={async (p) => {
        const { suppressions, stats, files } = p.payload as { suppressions: Suppression[]; stats: unknown; files: string };
        const r = await importEmailEventsAction(files, suppressions, stats);
        if (!r.ok) return r;
        const x = r.result;
        return {
          ok: true,
          lines: [
            `Do-not-email list: ${n(x.list_total)} addresses (${n(x.suppression_list)} from these files).`,
            `Contacts changed now: ${n(x.contacts_unsubscribed)} unsubscribed, ${n(x.contacts_bounced)} bounced. In total ${n(x.contacts_now_unsubscribed)} unsubscribed and ${n(x.contacts_now_bounced)} bounced.`,
          ],
        };
      }}
    />
  );
}
