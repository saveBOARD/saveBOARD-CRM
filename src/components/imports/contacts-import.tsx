"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { FileUp } from "lucide-react";
import { importContacts, type ImportOutcome } from "@/app/(app)/import-actions";
import { formatDateTime } from "@/lib/format";
import { mapHubspotContacts, type HubspotContactRow } from "@/lib/hubspot-contacts";

type Parsed = { fileName: string; rows: HubspotContactRow[]; ignored: string[] };

// Upload the HubSpot contacts export. The file is read in the browser, checked, previewed, then sent as rows to
// the server (nothing is stored as a file). Re-loading matches on HubSpot id, so it never duplicates.
export function ContactsImport({ lastImportAt }: { lastImportAt: string | null }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, start] = useTransition();

  function onFile(file: File | undefined) {
    setParsed(null);
    setProblem(null);
    setOutcome(null);
    setConfirmed(false);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setProblem("Choose the .csv file exported from HubSpot.");
      return;
    }
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const m = mapHubspotContacts(res.data);
        if (m.missing.length > 0) {
          setProblem(`This isn't the HubSpot contacts export: missing column(s) ${m.missing.join(", ")}.`);
        } else if (m.rows.length === 0) {
          setProblem("The file has no contacts.");
        } else {
          setParsed({ fileName: file.name, rows: m.rows, ignored: m.ignored });
        }
      },
      error: (err) => setProblem(`Couldn't read the file: ${err.message}`),
    });
  }

  function load() {
    if (!parsed) return;
    start(async () => {
      const r = await importContacts(parsed.fileName, parsed.rows);
      setOutcome(r);
      if (r.ok) setParsed(null);
    });
  }

  const preview = parsed?.rows.slice(0, 5) ?? [];

  return (
    <div className="grid gap-4">
      <label className="flex flex-wrap items-center gap-3">
        <span className="btn-secondary cursor-pointer">
          <FileUp className="h-4 w-4" aria-hidden />
          Choose contacts CSV
        </span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} disabled={pending} />
        <span className="text-sm text-muted">From HubSpot: Contacts, All contacts, Export, CSV.</span>
      </label>

      {problem && (
        <p role="alert" className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
          {problem}
        </p>
      )}

      {parsed && (
        <div className="grid gap-3 rounded border border-line p-4">
          <p className="text-sm">
            <b>{parsed.fileName}</b>: <b>{parsed.rows.length.toLocaleString("en-NZ")}</b> contacts found.
            {parsed.ignored.length > 0 && <span className="text-muted"> Ignored columns: {parsed.ignored.join(", ")}.</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-normal">Name</th>
                  <th className="py-1 pr-3 font-normal">Email</th>
                  <th className="py-1 pr-3 font-normal">Company</th>
                  <th className="py-1 pr-3 font-normal">Owner</th>
                  <th className="py-1 pr-3 font-normal">Country</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.record_id} className="border-b border-line last:border-0">
                    <td className="py-1 pr-3">{`${r.first_name} ${r.last_name}`.trim() || <span className="text-muted">(no name)</span>}</td>
                    <td className="py-1 pr-3">{r.email}</td>
                    <td className="py-1 pr-3">{r.associated_company}</td>
                    <td className="py-1 pr-3">{r.contact_owner}</td>
                    <td className="py-1 pr-3">{r.country_region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lastImportAt && (
            <label className="flex items-start gap-2 rounded bg-[#fff6e0] px-3 py-2 text-sm text-warn">
              <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>
                Contacts were already loaded on {formatDateTime(lastImportAt)}. Loading again updates them from HubSpot and can overwrite changes made in
                the CRM since. Only do this before switching off HubSpot.
              </span>
            </label>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={load} disabled={pending || (!!lastImportAt && !confirmed)}>
              {pending ? `Loading ${parsed.rows.length.toLocaleString("en-NZ")} contacts…` : `Load ${parsed.rows.length.toLocaleString("en-NZ")} contacts`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setParsed(null)} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {outcome && !outcome.ok && (
        <p role="alert" className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
          {outcome.message}
        </p>
      )}
      {outcome?.ok && (
        <div role="status" className="grid gap-2 rounded bg-ok/15 px-4 py-3 text-sm">
          <p className="font-medium text-ok">
            Loaded {outcome.result.rows_read.toLocaleString("en-NZ")} rows: {outcome.result.contacts_created.toLocaleString("en-NZ")} contacts added,{" "}
            {outcome.result.contacts_updated.toLocaleString("en-NZ")} updated, {outcome.result.contacts_skipped.toLocaleString("en-NZ")} skipped;{" "}
            {outcome.result.companies_created.toLocaleString("en-NZ")} companies added, {outcome.result.companies_updated.toLocaleString("en-NZ")} updated.
          </p>
          {outcome.suggestions > 0 && (
            <p>
              {outcome.suggestions} ERP match suggestion(s) to review in{" "}
              <Link href="/admin/matches" className="text-link hover:underline">
                ERP matches
              </Link>
              .
            </p>
          )}
          <details>
            <summary className="cursor-pointer font-medium">Check against HubSpot</summary>
            <table className="mt-2 text-sm">
              <tbody>
                {outcome.result.report.map((r) => (
                  <tr key={r.measure}>
                    <td className="pr-6">{r.measure}</td>
                    <td className="text-right tabular-nums">{Number(r.n).toLocaleString("en-NZ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}
