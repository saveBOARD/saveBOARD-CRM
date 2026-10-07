// HubSpot email campaign result exports ("email events, basic, recipients list"): one row per recipient per
// campaign. Turned into a suppression list using the consent rules approved by Paul on 7 Oct 2026:
//   UNSUBSCRIBED: clicked unsubscribe, already unsubscribed when HubSpot tried to send, spam report, or blocked.
//   BOUNCED:      a permanent failure: previously bounced, unknown user, mailbox misconfigured.
//   Otherwise unknown: temporary or filter bounces (e.g. FILTERED, THROTTLED). Receiving or opening is NOT consent.

export const EMAIL_EVENT_COLUMNS = ["Recipient", "Sent At (Your time zone)", "Not Sent Reason", "Bounce Reason", "Bounce", "Spam Report", "Unsubscribed"] as const;

const UNSUBSCRIBED_NOT_SENT = new Set(["PREVIOUSLY_UNSUBSCRIBED_PORTAL", "PREVIOUSLY_UNSUBSCRIBED_MESSAGE", "BLOCKED_ADDRESS"]);
const HARD_BOUNCE_REASONS = new Set(["UNKNOWN_USER", "MAILBOX_MISCONFIGURATION"]);

export type Suppression = { email: string; status: "unsubscribed" | "bounced"; reason: string; occurred_at: string };
export type EventStats = { files: number; rows: number; recipients: number; unsubscribed: number; bounced: number; soft_only: number };
export type ClassifiedEvents = { suppressions: Suppression[]; stats: EventStats; missing: { file: string; columns: string[] }[] };

const isTrue = (v: string | undefined) => (v ?? "").trim().toUpperCase() === "TRUE";

/** One row's outcome, or null when it says nothing about consent. */
export function classifyRow(row: Record<string, string>): { status: Suppression["status"]; reason: string } | "soft" | null {
  const notSent = (row["Not Sent Reason"] ?? "").trim().toUpperCase();
  const bounceReason = (row["Bounce Reason"] ?? "").trim().toUpperCase();
  if (isTrue(row.Unsubscribed)) return { status: "unsubscribed", reason: "clicked unsubscribe" };
  if (isTrue(row["Spam Report"])) return { status: "unsubscribed", reason: "reported spam" };
  if (UNSUBSCRIBED_NOT_SENT.has(notSent)) return { status: "unsubscribed", reason: notSent === "BLOCKED_ADDRESS" ? "blocked address" : "already unsubscribed" };
  if (notSent === "PREVIOUSLY_BOUNCED") return { status: "bounced", reason: "previously bounced" };
  if (isTrue(row.Bounce) && HARD_BOUNCE_REASONS.has(bounceReason)) return { status: "bounced", reason: bounceReason === "UNKNOWN_USER" ? "unknown user" : "mailbox misconfigured" };
  if (isTrue(row.Bounce)) return "soft";
  return null;
}

/** Combine all campaign files: unsubscribed outranks bounced, per address. */
export function classifyEmailEvents(files: { name: string; table: string[][] }[]): ClassifiedEvents {
  const best = new Map<string, Suppression>();
  const soft = new Set<string>();
  const recipients = new Set<string>();
  const missing: ClassifiedEvents["missing"] = [];
  let rows = 0;

  for (const f of files) {
    const [header = [], ...body] = f.table;
    const cols = header.map((h) => h.replace(/^﻿/, "").trim());
    const lack = EMAIL_EVENT_COLUMNS.filter((c) => !cols.includes(c));
    if (lack.length) {
      missing.push({ file: f.name, columns: lack });
      continue;
    }
    for (const cells of body) {
      if (!cells.some((c) => c.trim())) continue;
      const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
      const email = (row.Recipient ?? "").trim().toLowerCase();
      if (!email.includes("@")) continue;
      rows++;
      recipients.add(email);
      const r = classifyRow(row);
      if (r === "soft") soft.add(email);
      else if (r) {
        const prev = best.get(email);
        if (!prev || (prev.status === "bounced" && r.status === "unsubscribed")) {
          best.set(email, { email, ...r, occurred_at: (row["Sent At (Your time zone)"] ?? "").trim() });
        }
      }
    }
  }
  const suppressions = [...best.values()];
  return {
    suppressions,
    missing,
    stats: {
      files: files.length - missing.length,
      rows,
      recipients: recipients.size,
      unsubscribed: suppressions.filter((s) => s.status === "unsubscribed").length,
      bounced: suppressions.filter((s) => s.status === "bounced").length,
      soft_only: [...soft].filter((e) => !best.has(e)).length,
    },
  };
}
