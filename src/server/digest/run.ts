import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { listChase } from "@/server/crm/chase";
import { countTriage } from "@/server/mail/triage";
import { composeDigest, type DigestItem } from "./compose";
import { digestConfigured, isSaveboardAddress, sendDigestEmail } from "./send";

// The morning digest (phase 3.7): 7:30 am NZ time on weekdays, one email per active CRM user with something on their
// list. Vercel Cron runs at 18:30 and 19:30 UTC (7:30 am NZDT and NZST); only the run that falls at 7 am in NZ sends,
// and only once a day.

export type DigestRun = { skipped?: string; sent: string[]; empty: string[]; failed: { who: string; error: string }[] };

const TZ = "Pacific/Auckland";

function nzParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  return {
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? -1),
    date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now),
    label: new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(now),
  };
}

export function appBaseUrl(): string {
  const explicit = process.env.APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://saveboard-crm.vercel.app";
}

const hrefFor = (base: string, i: { deal_id: string | null; contact_id: string | null; company_id: string | null; link?: string | null }) =>
  i.link ? `${base}${i.link}` : i.deal_id ? `${base}/deals/${i.deal_id}` : i.contact_id ? `${base}/contacts/${i.contact_id}` : i.company_id ? `${base}/companies/${i.company_id}` : `${base}/`;

/**
 * Send the digests. `force` skips the time and once-a-day checks; `onlyProfileId` sends one person their own digest
 * now (the "send me a test" button) without marking the day as sent.
 */
export async function runDigest(opts: { now?: Date; force?: boolean; onlyProfileId?: string; fetchImpl?: typeof fetch } = {}): Promise<DigestRun> {
  const result: DigestRun = { sent: [], empty: [], failed: [] };
  const cfg = digestConfigured();
  if (!cfg.ok) return { ...result, skipped: cfg.problem };

  const now = opts.now ?? new Date();
  const nz = nzParts(now);
  const [last] = await rows<{ value: string }>(sql`select value from crm.settings where key = 'digest_last_sent_on'`);
  if (!opts.force && !opts.onlyProfileId) {
    if (["Sat", "Sun"].includes(nz.weekday)) return { ...result, skipped: "weekend" };
    if (nz.hour !== 7) return { ...result, skipped: `not 7 am in NZ (it's ${nz.hour}:xx)` };
    if (last?.value === nz.date) return { ...result, skipped: "already sent today" };
  }

  const base = appBaseUrl();
  const people = await rows<{ id: string; display_name: string; email: string }>(sql`
    select id, display_name, email from crm.profiles
    where active and email is not null ${opts.onlyProfileId ? sql`and id = ${opts.onlyProfileId}` : sql``}
    order by display_name`);
  const triage = await countTriage();

  for (const p of people) {
    if (!isSaveboardAddress(p.email)) continue; // never anyone outside saveBOARD
    try {
      const items = await listChase({ assignedTo: p.id });
      const fresh = await rows<{ id: string; title: string }>(sql`
        select id, title from crm.deals
        where owner_id = ${p.id} and source = 'website_form' and deleted_at is null and created_at > now() - interval '1 day'
        order by created_at desc`);
      const mail = composeDigest({
        firstName: p.display_name.split(" ")[0],
        dateLabel: nz.label,
        baseUrl: base,
        items: items.map<DigestItem>((i) => ({ rule: i.rule, title: i.title, detail: i.detail, href: hrefFor(base, i) })),
        newEnquiries: fresh.map((d) => ({ title: d.title, href: `${base}/deals/${d.id}` })),
        triageSenders: triage,
      });
      if (!mail) {
        result.empty.push(p.display_name);
        continue;
      }
      await sendDigestEmail({ to: p.email, ...mail }, opts.fetchImpl);
      result.sent.push(p.display_name);
    } catch (e) {
      result.failed.push({ who: p.display_name, error: e instanceof Error ? e.message.slice(0, 200) : "failed" });
    }
  }

  // Mark the day done unless everything failed (then the 8:30 run tries again, once).
  if (!opts.onlyProfileId && (result.failed.length === 0 || result.sent.length > 0)) {
    await withActor({ type: "system", reason: "follow_up" }, (tx) =>
      tx.execute(sql`
        insert into crm.settings (key, value, note) values ('digest_last_sent_on', ${nz.date}, 'Date (NZ) the morning digest last went out')
        on conflict (key) do update set value = excluded.value, updated_at = now()`),
    );
  }
  return result;
}

export async function lastDigestDate(): Promise<string | null> {
  const [r] = await rows<{ value: string }>(sql`select value from crm.settings where key = 'digest_last_sent_on'`);
  return r?.value ?? null;
}
