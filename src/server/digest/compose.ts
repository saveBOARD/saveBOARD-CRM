// The morning digest's content (phase 3.7). Pure: no database, no sending. One short email per user: what's on their
// chase list today, new website enquiries since yesterday, and emails waiting in Inbox triage, with links into the CRM.

export type DigestItem = { rule: string; title: string; detail: string | null; href: string };
export type DigestInput = {
  firstName: string;
  dateLabel: string; // e.g. "Friday 9 October"
  baseUrl: string; // https://saveboard-crm.vercel.app
  items: DigestItem[];
  newEnquiries: { title: string; href: string }[];
  triageSenders: number;
};

const GROUP_TITLES: Record<string, string> = {
  slow_first_response: "New enquiries waiting for a first reply",
  quote_expiring: "Quotes about to expire",
  quote_unanswered: "Quotes with no reply",
  email_follow_up: "Follow-ups due",
  call_follow_up: "Call follow-ups",
  visit_follow_up: "Consultant visit follow-ups",
  gone_quiet: "Gone quiet",
  specifier_followup: "Specifier follow-ups",
  existing_customer_checkin: "Customer check-ins",
  suggest_negotiation: "Suggestions",
};
const ORDER = Object.keys(GROUP_TITLES);
const MAX_PER_GROUP = 8;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Null when there's nothing to say: no digest is sent on an empty day. */
export function composeDigest(d: DigestInput): { subject: string; html: string; text: string } | null {
  if (d.items.length === 0 && d.newEnquiries.length === 0 && d.triageSenders === 0) return null;

  const groups = ORDER.map((rule) => ({ rule, title: GROUP_TITLES[rule], items: d.items.filter((i) => i.rule === rule) })).filter((g) => g.items.length);
  const today = `${d.baseUrl}/`;
  const subject = `CRM today: ${d.items.length} to chase${d.newEnquiries.length ? `, ${d.newEnquiries.length} new enquir${d.newEnquiries.length === 1 ? "y" : "ies"}` : ""}`;

  const text: string[] = [`Morning ${d.firstName},`, "", `Your CRM for ${d.dateLabel}.`, ""];
  const html: string[] = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2933;max-width:600px">`,
    `<p>Morning ${esc(d.firstName)},</p><p>Your CRM for ${esc(d.dateLabel)}.</p>`,
  ];

  if (d.newEnquiries.length) {
    text.push(`New website enquiries since yesterday (${d.newEnquiries.length}):`, ...d.newEnquiries.map((e) => `- ${e.title}: ${e.href}`), "");
    html.push(
      `<h3 style="font-size:15px;margin:16px 0 4px">New website enquiries since yesterday (${d.newEnquiries.length})</h3><ul style="margin:0;padding-left:18px">`,
      ...d.newEnquiries.map((e) => `<li><a href="${esc(e.href)}">${esc(e.title)}</a></li>`),
      `</ul>`,
    );
  }
  for (const g of groups) {
    const shown = g.items.slice(0, MAX_PER_GROUP);
    const more = g.items.length - shown.length;
    text.push(`${g.title} (${g.items.length}):`, ...shown.map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ""}: ${i.href}`));
    if (more > 0) text.push(`- and ${more} more: ${today}`);
    text.push("");
    html.push(
      `<h3 style="font-size:15px;margin:16px 0 4px">${esc(g.title)} (${g.items.length})</h3><ul style="margin:0;padding-left:18px">`,
      ...shown.map((i) => `<li><a href="${esc(i.href)}">${esc(i.title)}</a>${i.detail ? ` <span style="color:#6b7280">${esc(i.detail)}</span>` : ""}</li>`),
      more > 0 ? `<li><a href="${esc(today)}">and ${more} more</a></li>` : "",
      `</ul>`,
    );
  }
  if (d.triageSenders) {
    const line = `${d.triageSenders} unknown sender${d.triageSenders === 1 ? "" : "s"} waiting in Inbox triage`;
    text.push(`${line}: ${d.baseUrl}/inbox`, "");
    html.push(`<p style="margin-top:16px"><a href="${esc(`${d.baseUrl}/inbox`)}">${esc(line)}</a></p>`);
  }
  text.push(`Open today's list: ${today}`, "", "Sent by the saveBOARD CRM to CRM users only.");
  html.push(
    `<p style="margin-top:20px"><a href="${esc(today)}" style="background:#1f6f43;color:#fff;padding:8px 14px;border-radius:4px;text-decoration:none">Open today's list</a></p>`,
    `<p style="color:#6b7280;font-size:12px;margin-top:24px">Sent by the saveBOARD CRM to CRM users only.</p></div>`,
  );
  return { subject, html: html.join(""), text: text.join("\n") };
}
