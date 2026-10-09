// Consultant visit report file names (phase 4.3), e.g. "Report to Save Board Limited for August 2026_Northern.xlsx".
// Shared by the upload screen (to pre-fill each file's region and month) and the server.

export const REGIONS = ["Northern", "Central", "Southern"] as const;
export type Region = (typeof REGIONS)[number];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** -> { month: "2026-08", region: "Northern" } (either may be null when the name doesn't say). */
export function hintsFromFileName(name: string): { month: string | null; region: Region | null } {
  const m = new RegExp(`(${MONTHS.join("|")})\s+(\d{4})`, "i").exec(name);
  const month = m ? `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}` : null;
  const region = REGIONS.find((x) => new RegExp(`\b${x}\b`, "i").test(name.replace(/_/g, " "))) ?? null;
  return { month, region };
}
