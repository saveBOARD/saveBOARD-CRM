// Deciding what an Outlook message means for the CRM (phase 3.2). Pure functions: no database, no Graph calls.
// A message is either skipped, or reduced to the outside addresses it involves and its direction. The sync then
// looks those addresses up: known contacts get an activity, an unknown sender of inbound mail goes to triage.

/** saveBOARD's own domains. Mail where everyone is on these is internal and never logged. */
export const INTERNAL_DOMAINS = ["saveboard.nz", "saveboard.com.au"] as const;

export type GraphAddress = { emailAddress?: { address?: string | null; name?: string | null } | null } | null;

/** The fields the sync asks Graph for. Bodies are never requested. */
export type GraphMessage = {
  id: string;
  internetMessageId?: string | null;
  subject?: string | null;
  from?: GraphAddress;
  sender?: GraphAddress;
  toRecipients?: GraphAddress[] | null;
  ccRecipients?: GraphAddress[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  webLink?: string | null;
  conversationId?: string | null;
  isDraft?: boolean | null;
  inferenceClassification?: "focused" | "other" | null;
  "@removed"?: unknown;
};

export const MESSAGE_FIELDS =
  "internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,webLink,conversationId,isDraft,inferenceClassification";

export type Party = { address: string; name: string | null };

export type Classified =
  | { kind: "skip"; reason: SkipReason }
  | {
      kind: "candidate";
      key: string; // internetMessageId: the same email in two mailboxes has the same key
      messageId: string; // Graph id in the mailbox it was read from (to fetch the text for the summary)
      direction: "inbound" | "outbound";
      occurredAt: string;
      subject: string | null;
      webLink: string | null;
      conversationId: string | null;
      from: Party | null;
      /** Outside addresses involved: the sender (inbound) and any outside to/cc recipients. */
      outside: Party[];
      /** The inbound sender looks automated (no-reply, newsletters, Outlook's "Other" tab): never sent to triage. */
      automated: boolean;
    };

export type SkipReason = "removed" | "draft" | "no_id" | "internal" | "ignored";

const AUTOMATED_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|noreply-.*|.*-noreply|notifications?|notify|mailer-daemon|postmaster|bounces?(\+.*)?|newsletters?|news|marketing|alerts?|updates|digest|automated|system|wordpress|calendar-notification)$/;

export function normaliseAddress(a: string | null | undefined): string | null {
  const s = a?.trim().toLowerCase();
  return s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}

export const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);

export function isInternal(address: string, internal: readonly string[] = INTERNAL_DOMAINS): boolean {
  const d = domainOf(address);
  return internal.some((i) => d === i || d.endsWith(`.${i}`));
}

export function looksAutomated(address: string): boolean {
  return AUTOMATED_LOCAL.test(address.slice(0, address.lastIndexOf("@")));
}

/** True if the ignore list covers this address: the address itself, its domain, or a parent domain. */
export function isIgnored(address: string, ignore: ReadonlySet<string>): boolean {
  if (ignore.has(address)) return true;
  const parts = domainOf(address).split(".");
  for (let i = 0; i < parts.length - 1; i++) if (ignore.has(parts.slice(i).join("."))) return true;
  return false;
}

function party(a: GraphAddress | undefined): Party | null {
  const address = normaliseAddress(a?.emailAddress?.address);
  return address ? { address, name: a?.emailAddress?.name?.trim() || null } : null;
}

export function classify(m: GraphMessage, ignore: ReadonlySet<string>, internal: readonly string[] = INTERNAL_DOMAINS): Classified {
  if (m["@removed"]) return { kind: "skip", reason: "removed" };
  if (m.isDraft) return { kind: "skip", reason: "draft" };
  const key = m.internetMessageId?.trim();
  if (!key) return { kind: "skip", reason: "no_id" };

  const from = party(m.from ?? m.sender);
  const recipients = [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map(party).filter((p): p is Party => p !== null);
  const fromInternal = from ? isInternal(from.address, internal) : true;
  const direction = fromInternal ? "outbound" : "inbound";

  const seen = new Set<string>();
  const outside: Party[] = [];
  for (const p of [...(fromInternal ? [] : [from!]), ...recipients]) {
    if (isInternal(p.address, internal) || seen.has(p.address)) continue;
    seen.add(p.address);
    outside.push(p);
  }
  if (outside.length === 0) return { kind: "skip", reason: "internal" };

  const kept = outside.filter((p) => !isIgnored(p.address, ignore));
  // Inbound from an ignored sender is skipped outright, even if a contact is copied in.
  if (kept.length === 0 || (direction === "inbound" && isIgnored(from!.address, ignore))) return { kind: "skip", reason: "ignored" };

  return {
    kind: "candidate",
    key,
    messageId: m.id,
    direction,
    occurredAt: (direction === "inbound" ? m.receivedDateTime : (m.sentDateTime ?? m.receivedDateTime)) ?? new Date().toISOString(),
    subject: m.subject?.trim() || null,
    webLink: m.webLink ?? null,
    conversationId: m.conversationId ?? null,
    from,
    outside: kept,
    automated: direction === "inbound" && (looksAutomated(from!.address) || m.inferenceClassification === "other"),
  };
}

/** Company suggestion for "Add as contact": the sender's web domain, unless it's a free-mail domain. */
export function suggestedDomain(address: string, freeDomains: ReadonlySet<string>): string | null {
  const d = domainOf(address);
  return freeDomains.has(d) ? null : d;
}

/** Split "Jane Q. Smith" into first and last name for the triage form. */
export function splitName(name: string | null, address: string): { first: string | null; last: string | null } {
  const clean = name?.replace(/["']/g, "").trim();
  if (!clean || clean.toLowerCase() === address) return { first: null, last: null };
  if (clean.includes(",")) {
    const [last, first] = clean.split(",", 2).map((s) => s.trim());
    return { first: first || null, last: last || null };
  }
  const parts = clean.split(/\s+/);
  return parts.length === 1 ? { first: parts[0], last: null } : { first: parts.slice(0, -1).join(" "), last: parts.at(-1)! };
}

/**
 * Website form notifications, as sent by the website's form tool (examples from Paul, 8 Oct 2026):
 * "A site visitor just submitted your form saveBOARD Enquiries Form 2 on Save Board NZ" / "...Form 5 on Save Board AU".
 */
const REPLY = /^\s*(re|fw|fwd)\s*:/i;

export function isWebsiteForm(subject: string | null | undefined): boolean {
  return !!subject && !REPLY.test(subject) && /submitted (your|a) form|form \d+ on save ?board/i.test(subject);
}

/** Online shop order notifications: "New Order Received! Order #1234". Replies and forwards are ordinary email. */
export function isShopOrder(subject: string | null | undefined): boolean {
  return !!subject && !REPLY.test(subject) && /new order received!?.*order\s*#/i.test(subject);
}
