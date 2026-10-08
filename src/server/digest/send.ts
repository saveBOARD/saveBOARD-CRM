import "server-only";
import { INTERNAL_DOMAINS } from "@/server/mail/classify";

// The ONLY email the CRM sends itself: the internal morning digest, through the digest email service (Resend), to
// active CRM users at saveBOARD addresses only (CLAUDE.md hard rule 4, reworded with Paul's approval 7 Oct 2026).
// Customer email is never sent by the CRM: chase emails are Outlook drafts a person sends.

/** True only for an address on saveBOARD's own domains. Enforced on every send, whatever the caller passes. */
export function isSaveboardAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(a)) return false;
  const domain = a.slice(a.lastIndexOf("@") + 1);
  return (INTERNAL_DOMAINS as readonly string[]).includes(domain);
}

export function digestConfigured(): { ok: true; from: string } | { ok: false; problem: string } {
  const key = process.env.RESEND_API_KEY ?? "";
  const from = process.env.DIGEST_FROM ?? "";
  if (!key.startsWith("re_")) return { ok: false, problem: "RESEND_API_KEY is not set" };
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  if (!isSaveboardAddress(address)) return { ok: false, problem: "DIGEST_FROM must be a saveboard.nz or saveboard.com.au address" };
  return { ok: true, from };
}

export class NotInternal extends Error {
  constructor(address: string) {
    super(`Refused: the CRM only emails saveBOARD addresses (${address})`);
    this.name = "NotInternal";
  }
}

/** Send one digest. Throws (and sends nothing) unless the recipient is a saveBOARD address. */
export async function sendDigestEmail(
  m: { to: string; subject: string; html: string; text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
  if (!isSaveboardAddress(m.to)) throw new NotInternal(m.to);
  const cfg = digestConfigured();
  if (!cfg.ok) throw new Error(cfg.problem);
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [m.to.trim().toLowerCase()], subject: m.subject, html: m.html, text: m.text }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !body.id) throw new Error(`The email service refused the digest (${res.status} ${body.name ?? ""} ${body.message ?? ""})`.trim());
  return { id: body.id };
}
