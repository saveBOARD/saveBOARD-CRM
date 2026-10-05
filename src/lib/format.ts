// Display formats. Money follows the ERP (docs/erp-reference/Design.md §7). Dates follow CLAUDE.md:
// NZ/AU day/month/year, shown in NZ time unless the record's entity is AUS.

export type Entity = "NZ" | "AUS";
export type Currency = "NZD" | "AUD";

export const TIME_ZONE: Record<Entity, string> = {
  NZ: "Pacific/Auckland",
  AUS: "Australia/Sydney",
};

const money2 = new Intl.NumberFormat("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `5,995.00 NZD`. Pass `currency: null` for a currency column where the header states it. */
export function formatMoney(amount: number | string | null | undefined, currency: Currency | string | null): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "";
  const value = money2.format(n);
  return currency ? `${value} ${currency}` : value;
}

/** A Postgres `date` (`2026-09-30`) as `30/09/2026`. No time zone conversion: a date is a calendar day. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** A timestamp as `30/09/2026, 4:21 pm` in the entity's time zone (NZ by default). */
export function formatDateTime(value: Date | string | null | undefined, entity: Entity = "NZ"): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: TIME_ZONE[entity],
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** Whole days between a timestamp and now, for "last activity 9 days ago". */
export function daysSince(value: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/** The NZ (or AUS) calendar day of a timestamp as 'YYYY-MM-DD', for date columns and filters. */
export function toLocalDate(value: Date | string | null | undefined, entity: Entity = "NZ"): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE[entity], year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
