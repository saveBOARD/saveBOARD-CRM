"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { FileUp } from "lucide-react";

// Shared upload flow for HubSpot files: choose -> read and check in the browser -> preview -> load -> result.
// Files are never stored: rows go straight to the server action.

export type ParsedFile = { name: string; table: string[][] };
export type Prepared = {
  label: string;
  summary: string;
  preview?: { headers: string[]; rows: string[][] };
  payload: unknown;
  loadLabel: string;
};
export type LoadResult = { ok: true; lines: string[] } | { ok: false; message: string };

function readFile(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) =>
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => resolve({ name: file.name, table: res.data }),
      error: (err) => reject(err),
    }),
  );
}

export function CsvImport({
  chooseLabel,
  help,
  multiple = false,
  prepare,
  load,
}: {
  chooseLabel: string;
  help: string;
  multiple?: boolean;
  prepare: (files: ParsedFile[]) => Prepared | { problem: string };
  load: (p: Prepared) => Promise<LoadResult>;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [pending, start] = useTransition();

  async function onFiles(list: FileList | null) {
    setPrepared(null);
    setProblem(null);
    setResult(null);
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    const notCsv = files.filter((f) => !/\.csv$/i.test(f.name));
    if (notCsv.length) {
      setProblem(`Choose the .csv file(s) exported from HubSpot (not ${notCsv.map((f) => f.name).join(", ")}).`);
      return;
    }
    try {
      const p = prepare(await Promise.all(files.map(readFile)));
      if ("problem" in p) setProblem(p.problem);
      else setPrepared(p);
    } catch (e) {
      setProblem(`Couldn't read the file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function onLoad() {
    if (!prepared) return;
    start(async () => {
      const r = await load(prepared);
      setResult(r);
      if (r.ok) setPrepared(null);
    });
  }

  return (
    <div className="grid gap-4">
      <label className="flex flex-wrap items-center gap-3">
        <span className="btn-secondary cursor-pointer">
          <FileUp className="h-4 w-4" aria-hidden />
          {chooseLabel}
        </span>
        <input type="file" accept=".csv,text/csv" multiple={multiple} className="sr-only" onChange={(e) => onFiles(e.target.files)} disabled={pending} />
        <span className="text-sm text-muted">{help}</span>
      </label>

      {problem && (
        <p role="alert" className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
          {problem}
        </p>
      )}

      {prepared && (
        <div className="grid gap-3 rounded border border-line p-4">
          <p className="text-sm">
            <b>{prepared.label}</b>: {prepared.summary}
          </p>
          {prepared.preview && prepared.preview.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    {prepared.preview.headers.map((h) => (
                      <th key={h} className="py-1 pr-3 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {prepared.preview.rows.map((r, i) => (
                    <tr key={i} className="border-b border-line align-top last:border-0">
                      {r.map((c, j) => (
                        <td key={j} className="max-w-md py-1 pr-3">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={onLoad} disabled={pending}>
              {pending ? "Loading…" : prepared.loadLabel}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPrepared(null)} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <p role="alert" className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
          {result.message}
        </p>
      )}
      {result?.ok && (
        <div role="status" className="grid gap-1 rounded bg-ok/15 px-4 py-3 text-sm text-ok">
          {result.lines.map((l, i) => (
            <p key={i} className={i === 0 ? "font-medium" : ""}>
              {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
