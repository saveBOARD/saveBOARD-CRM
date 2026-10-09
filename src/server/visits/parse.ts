import "server-only";
import ExcelJS from "exceljs";

// Reading the consultancy's monthly visit reports (phase 4.3). One sheet, one row per practice visited. Three layouts
// seen in the May to September 2026 samples (columns in a different order, "Client D"/"Client C" and "Type"/"Practice
// Type" headings): columns are found by their headings, so any of them works without a manual mapping. The visit date
// isn't in the file: the report's month (and region) come from the file name, confirmed by the person uploading.

import { REGIONS, type Region } from "@/lib/visit-files";

export { REGIONS, type Region };

export type VisitRow = {
  row: number; // row number in the sheet
  group: string | null; // Priority Feedback / General Feedback
  practice: string | null;
  contactName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  city: string | null;
  website: string | null;
  type: string | null; // Architects, Architectural Designers, Engineers...
  predominant: string | null;
  workload: string | null;
  provided: string | null; // "saveBOARD brochure(s) provided; betterBRACE sample provided"
  comments: string | null;
  seen: string | null; // VisitContact: who was actually seen, when different
};

export type ParsedReport = { layout: string; rows: VisitRow[]; skipped: { row: number; reason: string }[] };

const HEADINGS: Record<keyof Omit<VisitRow, "row" | "firstName" | "lastName" | "city">, RegExp> = {
  group: /^ReportGroup[A-Z]?$/i,
  practice: /^Practice$/i,
  contactName: /^Contact Fullname$/i,
  email: /^Email$/i,
  phone: /^Phone contact$/i,
  location: /^PracticeLocation$/i,
  website: /^webpage$/i,
  type: /^(Practice )?Type$/i,
  predominant: /^Predominant$/i,
  workload: /^Workload$/i,
  provided: /^Client [A-Z] ActivityTxt$/i,
  comments: /^Client [A-Z] CommentSSR$/i,
  seen: /^VisitContact$/i,
};

const text = (v: ExcelJS.CellValue): string | null => {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === "object") {
    if (v instanceof Date) s = v.toISOString().slice(0, 10);
    else if ("richText" in v) s = v.richText.map((t) => t.text).join("");
    else if ("text" in v && typeof v.text === "string") s = v.text;
    else if ("result" in v) s = String(v.result ?? "");
    else s = String(v);
  } else s = String(v);
  const t = s.replace(/\r/g, "").trim();
  return t || null;
};

const oneLine = (s: string | null) => (s ? s.replace(/\s*\n\s*/g, "; ").replace(/\s{2,}/g, " ").trim() || null : null);

/** "Mr Rob  Smith" -> Rob / Smith (titles dropped, spaces tidied). */
export function splitPersonName(full: string | null): { first: string | null; last: string | null; full: string | null } {
  const clean = full?.replace(/\s+/g, " ").replace(/^(mr|mrs|ms|miss|dr|mx)\.?\s+/i, "").trim() || null;
  if (!clean) return { first: null, last: null, full: null };
  const parts = clean.split(" ");
  return parts.length === 1 ? { first: parts[0], last: null, full: clean } : { first: parts.slice(0, -1).join(" "), last: parts.at(-1)!, full: clean };
}

export async function parseVisitReport(data: ArrayBuffer): Promise<ParsedReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets.find((w) => w.state === "visible") ?? wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheets.");

  const cols: Partial<Record<keyof typeof HEADINGS, number>> = {};
  ws.getRow(1).eachCell((c, n) => {
    const h = text(c.value) ?? "";
    for (const [key, re] of Object.entries(HEADINGS) as [keyof typeof HEADINGS, RegExp][]) if (cols[key] === undefined && re.test(h)) cols[key] = n;
  });
  const missing = (["practice", "contactName"] as const).filter((k) => cols[k] === undefined);
  if (missing.length) throw new Error("This doesn't look like a consultant visit report (no Practice or Contact Fullname column).");
  // A short name for the layout (the order its columns come in), used to remember which region a layout is.
  const layout = (Object.entries(cols) as [string, number][])
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k.slice(0, 2))
    .join("");

  const rows: VisitRow[] = [];
  const skipped: ParsedReport["skipped"] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (k: keyof typeof HEADINGS) => (cols[k] ? text(row.getCell(cols[k]!).value) : null);
    const practice = oneLine(get("practice"));
    const name = splitPersonName(get("contactName"));
    const email = get("email")?.toLowerCase().match(/[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+/)?.[0] ?? null;
    if (!practice && !name.full && !email && !get("comments")) continue; // blank row
    if (!name.full && !email) {
      skipped.push({ row: r, reason: "No contact name or email" });
      continue;
    }
    const location = get("location");
    rows.push({
      row: r,
      group: oneLine(get("group")),
      practice,
      contactName: name.full,
      firstName: name.first,
      lastName: name.last,
      email,
      phone: oneLine(get("phone")),
      location: oneLine(location),
      city: location?.split("\n").map((s) => s.trim()).filter(Boolean).at(-1) ?? null,
      website: get("website"),
      type: oneLine(get("type")),
      predominant: oneLine(get("predominant")),
      workload: oneLine(get("workload")),
      provided: oneLine(get("provided")),
      comments: get("comments"),
      seen: oneLine(get("seen")),
    });
  }
  return { layout, rows, skipped };
}

/** The practice type as a CRM segment. */
export function segmentFor(type: string | null): "architect_designer" | "builder" | "other_stakeholder" | "unknown" {
  if (!type) return "unknown";
  if (/architect|design(er|ers)?\b|draught/i.test(type) && !/construction/i.test(type)) return "architect_designer";
  if (/construction|builder/i.test(type)) return "builder";
  if (/engineer/i.test(type)) return "other_stakeholder";
  return "unknown";
}
