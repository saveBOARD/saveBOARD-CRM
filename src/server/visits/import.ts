import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { rows, type Tx } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { claudeConfigured } from "@/server/claude/summarise";
import { readVisitWithClaude, type VisitAction, type VisitActionReader } from "@/server/claude/visit-action";
import { toLocalDate } from "@/lib/format";
import { parseVisitReport, segmentFor, type Region, type VisitRow } from "./parse";

// Consultant visit reports (phase 4.3; Paul, 9 Oct 2026). Each row becomes a visit on the contact's timeline with the
// consultant's notes. Contacts are matched by email, otherwise by name and practice (never by name alone); people not
// in the CRM are added (with their practice) as specifiers, owners alternating between Paul and Dave (all NZ).
// Follow-ups are made only when the upload asks for them (the latest month): Claude reads each comment and any action
// it finds becomes a chase item. Uploading a file again, or an overlapping one, creates nothing twice (row fingerprint).

export type VisitFileMeta = { fileName: string; region: Region; month: string; followUps: boolean }; // month: YYYY-MM-01

export type VisitPreview = {
  fileName: string;
  layout: string;
  rows: number;
  existing: number; // match a contact already in the CRM
  newContacts: number;
  alreadyImported: number;
  skipped: { row: number; reason: string }[];
};

export type VisitImportResult = VisitPreview & { visits: number; followUps: number; newCompanies: number; batchId: string };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Stable per visit: the same row in the same month and region is the same visit, whichever file it came in. */
export function rowHash(meta: { region: string; month: string }, r: VisitRow): string {
  const who = r.email ?? `${r.contactName ?? ""}|${r.practice ?? ""}`.toLowerCase();
  return createHash("sha256").update([meta.region, meta.month, who, (r.comments ?? "").replace(/\s+/g, " ").trim()].join("␟")).digest("hex");
}

type Match = { id: string; company_id: string | null; owner_id: string | null } | null;

async function matchContact(r: VisitRow, tx?: Tx): Promise<Match> {
  if (r.email) {
    const [c] = await rows<NonNullable<Match>>(sql`select id, company_id, owner_id from crm.contacts where lower(email) = ${r.email} and deleted_at is null`, tx);
    if (c) return c;
  }
  if (r.firstName && r.lastName && r.practice) {
    const [c] = await rows<NonNullable<Match>>(
      sql`select c.id, c.company_id, c.owner_id from crm.contacts c join crm.companies co on co.id = c.company_id
          where c.deleted_at is null and lower(c.first_name) = lower(${r.firstName}) and lower(c.last_name) = lower(${r.lastName})
            and co.name_norm = crm.normalize_name(${r.practice})
          limit 1`,
      tx,
    );
    if (c) return c;
  }
  return null;
}

async function known(hashes: string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set();
  const found = await rows<{ row_hash: string }>(sql`select row_hash from crm.visits where row_hash in (${sql.join(hashes.map((h) => sql`${h}`), sql`, `)})`);
  return new Set(found.map((f) => f.row_hash));
}

/** What an upload will do, before anything is saved. */
export async function previewVisitFile(data: ArrayBuffer, meta: VisitFileMeta): Promise<VisitPreview> {
  const parsed = await parseVisitReport(data);
  const done = await known(parsed.rows.map((r) => rowHash(meta, r)));
  let existing = 0;
  let newContacts = 0;
  let alreadyImported = 0;
  const seen = new Set<string>();
  for (const r of parsed.rows) {
    if (done.has(rowHash(meta, r))) {
      alreadyImported++;
      continue;
    }
    const key = r.email ?? `${r.firstName}|${r.lastName}|${r.practice}`.toLowerCase();
    if ((await matchContact(r)) || seen.has(key)) existing++;
    else newContacts++;
    seen.add(key);
  }
  return { fileName: meta.fileName, layout: parsed.layout, rows: parsed.rows.length, existing, newContacts, alreadyImported, skipped: parsed.skipped };
}

const domainOfUrl = (u: string | null) => {
  const m = u?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  return m && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(m) ? m : null;
};

/** Upload one report: visits, contacts and practices, and (if asked) follow-ups from the comments. */
export async function importVisitFile(
  actor: Actor & { type: "user" },
  data: ArrayBuffer,
  meta: VisitFileMeta,
  reader: VisitActionReader | null = claudeConfigured() ? readVisitWithClaude : null,
): Promise<VisitImportResult> {
  const parsed = await parseVisitReport(data);
  const hashes = parsed.rows.map((r) => rowHash(meta, r));
  const done = await known(hashes);
  const todo = parsed.rows.map((r, i) => ({ r, hash: hashes[i] })).filter((x) => !done.has(x.hash));

  // Claude reads the comments first, outside the database transaction (only when follow-ups were asked for).
  const today = toLocalDate(new Date())!;
  const actions = new Map<string, VisitAction>();
  if (meta.followUps && reader) {
    const queue = todo.filter((x) => x.r.comments);
    const worker = async () => {
      for (let x = queue.shift(); x; x = queue.shift()) {
        try {
          const a = await reader({ today, reportMonth: monthLabel(meta.month), group: x.r.group, workload: x.r.workload, provided: x.r.provided, comments: x.r.comments! });
          if (!("refused" in a)) actions.set(x.hash, a);
        } catch {
          // Claude unavailable for this row: the visit is still recorded, without a follow-up.
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  // The visit date: the end of the report's month (or today, for the current month).
  const [y, m] = [Number(meta.month.slice(0, 4)), Number(meta.month.slice(5, 7))];
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const visitedOn = monthEnd > today ? today : monthEnd;

  return withActor(actor, async (tx) => {
    const [batch] = await rows<{ id: string }>(
      sql`insert into crm.import_batches (kind, file_name, rows_read, created_by)
          values ('consultant_visits', ${meta.fileName}, ${parsed.rows.length}, ${actor.profileId}) returning id`,
      tx,
    );
    const pair = await rows<{ id: string }>(
      sql`select p.id from unnest(string_to_array((select value from crm.settings where key = 'web_enquiry_owners_nz'), ',')) with ordinality as e(email, n)
          join crm.profiles p on lower(p.email) = lower(trim(e.email)) and p.active order by e.n`,
      tx,
    );
    let turn = 0;
    const nextOwner = () => (pair.length ? pair[turn++ % pair.length].id : actor.profileId);

    let existing = 0;
    let newContacts = 0;
    let newCompanies = 0;
    let visits = 0;
    let followUps = 0;

    for (const { r, hash } of todo) {
      // Company: by practice name or web domain, else created.
      const domain = domainOfUrl(r.website) ?? (r.email ? r.email.slice(r.email.indexOf("@") + 1) : null);
      const [free] = domain ? await rows<{ free: boolean }>(sql`select exists (select 1 from crm.free_email_domains where domain = ${domain}) as free`, tx) : [{ free: true }];
      const bizDomain = domain && !free.free ? domain : null;

      let contact = await matchContact(r, tx);
      let companyId = contact?.company_id ?? null;
      if (!companyId && r.practice) {
        const [co] = await rows<{ id: string }>(
          sql`select id from crm.companies where deleted_at is null
                and (name_norm = crm.normalize_name(${r.practice}) ${bizDomain ? sql`or lower(domain) = ${bizDomain}` : sql``})
              order by (name_norm = crm.normalize_name(${r.practice})) desc limit 1`,
          tx,
        );
        companyId = co?.id ?? null;
        if (!companyId) {
          const [created] = await rows<{ id: string }>(
            sql`insert into crm.companies (name, domain, website, country_code, city, segment, owner_id, source)
                values (${r.practice}, ${bizDomain}, ${r.website ? (r.website.startsWith("http") ? r.website : `https://${r.website}`) : null}, 'NZ',
                        ${r.city}, ${segmentFor(r.type)}::crm.company_segment, ${contact?.owner_id ?? null}, 'consultant')
                returning id`,
            tx,
          );
          companyId = created.id;
          newCompanies++;
        }
      }

      if (contact) {
        existing++;
        await tx.execute(sql`
          update crm.contacts
             set is_specifier = true,
                 specifier_stage = coalesce(specifier_stage, 'visited'),
                 company_id = coalesce(company_id, ${companyId}),
                 phone_raw = coalesce(phone_raw, ${r.phone}),
                 phone_e164 = coalesce(phone_e164, crm.normalize_phone(${r.phone}, 'NZ')),
                 city = coalesce(city, ${r.city}),
                 role_title = coalesce(role_title, ${r.type}),
                 segment = case when segment = 'unknown' then ${segmentFor(r.type)}::crm.company_segment else segment end
           where id = ${contact.id}`);
      } else {
        const owner = nextOwner();
        const [c] = await rows<{ id: string }>(
          sql`insert into crm.contacts (first_name, last_name, email, phone_raw, phone_e164, company_id, country_code, city, role_title, segment,
                                        is_specifier, specifier_stage, owner_id, source)
              values (${r.firstName}, ${r.lastName}, ${r.email}, ${r.phone}, crm.normalize_phone(${r.phone}, 'NZ'), ${companyId}, 'NZ', ${r.city},
                      ${r.type}, ${segmentFor(r.type)}::crm.company_segment, true, 'visited', ${owner}, 'consultant')
              returning id`,
          tx,
        );
        contact = { id: c.id, company_id: companyId, owner_id: owner };
        await tx.execute(sql`update crm.companies set owner_id = coalesce(owner_id, ${owner}) where id = ${companyId}`);
        newContacts++;
      }

      const a = actions.get(hash);
      const act = a?.needs_follow_up ? a : null;
      const due = act ? (act.follow_up_date && /^\d{4}-\d{2}-\d{2}$/.test(act.follow_up_date) && act.follow_up_date > today ? act.follow_up_date : today) : null;
      const [owner] = await rows<{ owner_id: string | null }>(sql`select owner_id from crm.contacts where id = ${contact.id}`, tx);
      const meta2 = {
        region: meta.region,
        report_month: meta.month,
        group: r.group,
        workload: r.workload,
        predominant: r.predominant,
        seen: r.seen,
        next_step: act?.action ?? null,
        follow_up_on: due,
      };
      const summary = [r.provided ? `Provided: ${r.provided}.` : null, r.comments].filter(Boolean).join("\n").slice(0, 3000) || "Visited.";
      const [activity] = await rows<{ id: string }>(
        sql`insert into crm.activities (type, direction, subject, summary, occurred_at, contact_id, company_id, owner_id, origin, external_id, metadata)
            values ('visit', 'internal', ${`Consultant visit: ${meta.region}, ${monthLabel(meta.month)}`}, ${summary},
                    (${visitedOn}::date + time '12:00') at time zone 'Pacific/Auckland', ${contact.id}, ${companyId}, ${owner?.owner_id ?? null}, 'import',
                    ${`visit:${hash}`}, ${JSON.stringify(meta2)}::jsonb)
            on conflict (origin, external_id) where external_id is not null do nothing
            returning id`,
        tx,
      );
      const inserted = await rows<{ id: string }>(
        sql`insert into crm.visits (import_batch_id, consultant_name, visited_on, contact_id, company_id, notes, raw, row_hash, region, report_month,
                                    report_group, provided, action, follow_up_on, owner_id, activity_id, source_file, source_row)
            values (${batch.id}, ${`${meta.region} consultant`}, ${visitedOn}, ${contact.id}, ${companyId}, ${r.comments}, ${JSON.stringify(r)}::jsonb,
                    ${hash}, ${meta.region}, ${meta.month}, ${r.group}, ${r.provided}, ${act?.action ?? null}, ${due}, ${owner?.owner_id ?? null},
                    ${activity?.id ?? null}, ${meta.fileName}, ${r.row})
            on conflict (row_hash) do nothing
            returning id`,
        tx,
      );
      if (!inserted.length) continue;
      visits++;

      if (act) {
        await tx.execute(sql`
          insert into crm.tasks (title, detail, priority, due_on, contact_id, assigned_to, source, rule, created_by_claude)
          values (${(act.action ?? "Follow up the consultant's visit").slice(0, 200)},
                  ${`${meta.region} consultant visit, ${monthLabel(meta.month)}${r.practice ? `: ${r.practice}` : ""}`.slice(0, 300)},
                  5, ${due}::date, ${contact.id}, ${owner?.owner_id ?? actor.profileId}, 'consultant_visit', 'visit_follow_up', true)`);
        followUps++;
      }
    }

    const result = {
      fileName: meta.fileName,
      layout: parsed.layout,
      rows: parsed.rows.length,
      existing,
      newContacts,
      alreadyImported: done.size,
      skipped: parsed.skipped,
      visits,
      followUps,
      newCompanies,
      batchId: batch.id,
    };
    await tx.execute(sql`
      update crm.import_batches
         set rows_created = ${newContacts}, rows_updated = ${existing}, rows_skipped = ${done.size + parsed.skipped.length}, finished_at = now(),
             details = ${JSON.stringify({ region: meta.region, month: meta.month, visits, follow_ups: followUps, new_companies: newCompanies, layout: parsed.layout })}::jsonb
       where id = ${batch.id}`);
    return result;
  });
}

/** Which region each report layout was last uploaded as: pre-fills the region for files whose name doesn't say. */
export async function rememberedRegions(): Promise<Record<string, Region>> {
  const r = await rows<{ layout: string; region: Region }>(sql`
    select distinct on (details ->> 'layout') details ->> 'layout' as layout, details ->> 'region' as region
    from crm.import_batches where kind = 'consultant_visits' and details ? 'layout' and finished_at is not null
    order by details ->> 'layout', finished_at desc`);
  return Object.fromEntries(r.map((x) => [x.layout, x.region]));
}
