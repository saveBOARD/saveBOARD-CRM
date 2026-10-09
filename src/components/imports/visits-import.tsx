"use client";

import { useState } from "react";
import { checkVisitReport, importVisitReport, type VisitCheck, type VisitOutcome } from "@/app/(app)/import-actions";
import { hintsFromFileName, REGIONS, type Region } from "@/lib/visit-files";

type Item = {
  file: File;
  region: Region | "";
  month: string; // YYYY-MM
  followUps: boolean;
  check?: VisitCheck;
  outcome?: VisitOutcome;
};

const monthLabel = (m: string) =>
  m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" }) : "";

/**
 * Upload the consultancy's monthly visit reports (several at once). Each file's region and month are pre-filled from
 * its name (and from the region last used for that report layout); follow-ups from the comments are ticked only for
 * the latest month. Check shows what will happen; nothing is saved until Import.
 */
export function VisitsImport({ remembered }: { remembered: Record<string, Region> }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<"checking" | "importing" | null>(null);

  function choose(files: FileList | null) {
    const list = [...(files ?? [])].filter((f) => f.name.toLowerCase().endsWith(".xlsx"));
    const withHints = list.map((file) => {
      const h = hintsFromFileName(file.name);
      return { file, region: h.region ?? ("" as const), month: h.month ?? "", followUps: false };
    });
    // Follow-ups only for the most recent month in the batch, and only if it's recent (within about two months).
    const latest = withHints.map((i) => i.month).filter(Boolean).sort().at(-1) ?? "";
    const now = new Date();
    const recentFloor = `${new Date(now.getFullYear(), now.getMonth() - 2, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() - 2, 1).getMonth() + 1).padStart(2, "0")}`;
    setItems(withHints.map((i) => ({ ...i, followUps: !!i.month && i.month === latest && i.month >= recentFloor })));
  }

  const update = (n: number, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x, i) => (i === n ? { ...x, ...patch, check: patch.check ?? (patch.outcome ? x.check : undefined) } : x)));

  const form = (i: Item) => {
    const f = new FormData();
    f.set("file", i.file);
    f.set("region", i.region);
    f.set("month", i.month);
    f.set("follow_ups", i.followUps ? "on" : "off");
    return f;
  };

  async function checkAll() {
    setBusy("checking");
    for (let n = 0; n < items.length; n++) {
      const check = await checkVisitReport(form(items[n]));
      setItems((xs) =>
        xs.map((x, i) =>
          i === n ? { ...x, check, region: x.region || (check.ok ? (remembered[check.preview.layout] ?? "") : "") } : x,
        ),
      );
    }
    setBusy(null);
  }

  async function importAll() {
    setBusy("importing");
    for (let n = 0; n < items.length; n++) {
      if (items[n].outcome?.ok) continue;
      const outcome = await importVisitReport(form(items[n]));
      setItems((xs) => xs.map((x, i) => (i === n ? { ...x, outcome } : x)));
    }
    setBusy(null);
  }

  const canCheck = items.length > 0 && items.every((i) => i.month);
  const ready = canCheck && items.every((i) => i.region);
  const checked = ready && items.every((i) => i.check?.ok);
  const done = items.length > 0 && items.every((i) => i.outcome?.ok);

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        Each row becomes a visit on the person&apos;s timeline with the consultant&apos;s notes. People who aren&apos;t in the CRM are added (with their
        practice) as specifiers. With <b>Follow-ups</b> ticked, Claude reads each comment and turns any action it asks for into an item on the Today
        page; leave it unticked to load a report as history. Uploading a report twice adds nothing twice.
      </p>
      <input
        type="file"
        accept=".xlsx"
        multiple
        aria-label="Choose visit reports"
        onChange={(e) => choose(e.target.files)}
        className="text-sm"
        disabled={!!busy}
      />

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-3">File</th>
                <th className="py-1 pr-3">Region</th>
                <th className="py-1 pr-3">Month</th>
                <th className="py-1 pr-3">Follow-ups</th>
                <th className="py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, n) => {
                const c = i.check;
                const o = i.outcome;
                return (
                  <tr key={`${i.file.name}-${n}`} className="border-t border-line align-top">
                    <td className="py-2 pr-3 break-all">{i.file.name}</td>
                    <td className="py-2 pr-3">
                      <select
                        aria-label={`Region for ${i.file.name}`}
                        value={i.region}
                        onChange={(e) => update(n, { region: e.target.value as Region })}
                        className="input"
                        disabled={!!busy || !!o?.ok}
                      >
                        <option value="">Choose…</option>
                        {REGIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="month"
                        aria-label={`Month for ${i.file.name}`}
                        value={i.month}
                        onChange={(e) => update(n, { month: e.target.value })}
                        className="input"
                        disabled={!!busy || !!o?.ok}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        aria-label={`Create follow-ups for ${i.file.name}`}
                        checked={i.followUps}
                        onChange={(e) => update(n, { followUps: e.target.checked })}
                        disabled={!!busy || !!o?.ok}
                      />
                    </td>
                    <td className="py-2">
                      {o ? (
                        o.ok ? (
                          <span className="text-ok">
                            Done: {o.result.visits} visits, {o.result.newContacts} new contacts, {o.result.followUps} follow-ups
                            {o.result.alreadyImported ? `, ${o.result.alreadyImported} already in` : ""}.
                          </span>
                        ) : (
                          <span className="text-bad">{o.message}</span>
                        )
                      ) : c ? (
                        c.ok ? (
                          <span>
                            {monthLabel(i.month)}: {c.preview.rows} visits: {c.preview.existing} already in the CRM, {c.preview.newContacts} new
                            {c.preview.alreadyImported ? `, ${c.preview.alreadyImported} uploaded before (skipped)` : ""}
                            {c.preview.skipped.length ? `, ${c.preview.skipped.length} rows with no name or email (skipped)` : ""}.
                          </span>
                        ) : (
                          <span className="text-bad">{c.message}</span>
                        )
                      ) : (
                        <span className="text-muted">{!i.month ? "Pick the month" : "Not checked yet"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && !done && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={checkAll} disabled={!canCheck || !!busy}>
            {busy === "checking" ? "Checking…" : "Check"}
          </button>
          <button type="button" className="btn-primary" onClick={importAll} disabled={!checked || !!busy}>
            {busy === "importing" ? "Importing… (follow-ups take a little longer)" : `Import ${items.length} report${items.length === 1 ? "" : "s"}`}
          </button>
          {!ready && <span className="text-sm text-muted">Every file needs a month to check, and a region to import.</span>}
        </div>
      )}
    </div>
  );
}
