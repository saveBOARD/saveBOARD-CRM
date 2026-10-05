import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { Cell, Row, TableColumn } from "./types";

// Pure list logic shared by the DataTable and its tests: what a cell shows, filtering, sorting, totals.

export function displayValue(col: TableColumn, row: Row): string {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return "";
  switch (col.kind) {
    case "money":
      return formatMoney(v as number | string, null);
    case "number":
      return typeof v === "number" ? v.toLocaleString("en-NZ") : String(v);
    case "date":
      return formatDate(String(v));
    case "datetime":
      return formatDateTime(String(v));
    case "boolean":
      return v ? "Yes" : "";
    default:
      return String(v);
  }
}

const NUMBER_FILTER = /^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/;

/** Column filter: "contains" on what the cell shows; number and money columns also accept >, <, >=, <=, =. */
export function matchesFilter(col: TableColumn, row: Row, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (col.kind === "number" || col.kind === "money") {
    const m = NUMBER_FILTER.exec(q.replace(/,/g, ""));
    if (m) {
      const raw = row[col.key];
      if (raw === null || raw === "") return false;
      const n = Number(raw);
      const x = Number(m[2]);
      switch (m[1]) {
        case ">": return n > x;
        case "<": return n < x;
        case ">=": return n >= x;
        case "<=": return n <= x;
        default: return n === x;
      }
    }
  }
  return displayValue(col, row).toLowerCase().includes(q.toLowerCase());
}

/** Sort order for a column. Blanks always sort last. */
export function compareCells(col: TableColumn, a: Cell, b: Cell): number {
  const blankA = a === null || a === "";
  const blankB = b === null || b === "";
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  if (col.kind === "number" || col.kind === "money") return Number(a) - Number(b);
  if (col.kind === "boolean") return Number(a) - Number(b);
  // ISO dates and timestamps sort correctly as text; everything else in NZ alphabetical order.
  return String(a).localeCompare(String(b), "en-NZ", { sensitivity: "base", numeric: true });
}

/** Totals row text. Money is totalled per currency and never converted (CLAUDE.md). */
export function columnTotal(col: TableColumn, rows: Row[]): string {
  if (!col.total) return "";
  if (col.kind === "money") {
    const byCurrency = new Map<string, number>();
    for (const r of rows) {
      const v = r[col.key];
      if (v === null || v === "") continue;
      const cur = col.currencyKey ? String(r[col.currencyKey] ?? "") : "";
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + Number(v));
    }
    return [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cur, sum]) => formatMoney(sum, cur || null))
      .join(" · ");
  }
  const sum = rows.reduce((s, r) => s + (Number(r[col.key]) || 0), 0);
  return sum.toLocaleString("en-NZ");
}
