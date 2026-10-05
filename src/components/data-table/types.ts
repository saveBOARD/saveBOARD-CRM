import type { Tone } from "@/lib/labels";

// Column specs are plain data so server pages can pass them to the (client) DataTable.

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export type ColumnKind = "text" | "number" | "money" | "date" | "datetime" | "status" | "boolean";

export type TableColumn = {
  key: string;
  header: string;
  kind?: ColumnKind; // default "text"
  /** Link the cell to `${base}/${row[idKey]}`. */
  link?: { base: string; idKey: string };
  /** For money: the row field holding the currency code (NZD / AUD). */
  currencyKey?: string;
  /** For status: cell colour per displayed value. */
  tones?: Record<string, Tone>;
  /** Show a total in the totals row (number and money columns). */
  total?: boolean;
  /** Hidden until the user picks it in "Choose columns". */
  hidden?: boolean;
  mono?: boolean;
};
