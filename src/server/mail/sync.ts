import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { rows, type Tx } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { listMailAccounts } from "./accounts";
import { classify, MESSAGE_FIELDS, type Classified, type GraphMessage } from "./classify";
import { GraphError, graphGet, MailNotConnected } from "./graph";
import { syncSharedMailboxes, type SharedMailboxResult } from "./shared";

// Outlook mail sync (phase 3.2). For each connected user, reads Inbox and Sent Items with Microsoft's change
// tracking ("delta"), so each run only fetches what changed. Mail with a known contact becomes an email activity
// (subject, date, link; never the body). Inbound mail from an unknown, non-automated sender waits in Inbox triage.
// Every insert is "on conflict do nothing", so a repeated or overlapping run never logs anything twice.

export const FOLDERS = ["inbox", "sentitems"] as const;
export type Folder = (typeof FOLDERS)[number];

const SYNC: Actor = { type: "system", reason: "mail_sync" };
const PAGE_SIZE = 50;

export type FolderResult = { folder: Folder; seen: number; logged: number; triaged: number; finished: boolean; error?: string };
export type MailboxResult = { profileId: string; name: string; folders: FolderResult[]; error?: string };
export type SyncRun = { mailboxes: MailboxResult[]; shared: SharedMailboxResult[] };

type Page = { value?: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
type Candidate = Extract<Classified, { kind: "candidate" }>;
type ContactHit = { id: string; email: string; company_id: string | null; deal_id: string | null };

async function loadIgnoreList(): Promise<Set<string>> {
  return new Set((await rows<{ pattern: string }>(sql`select pattern from crm.mail_ignore`)).map((r) => r.pattern));
}

/** Contacts for these addresses, each with the open deal its email should be filed on (if any). */
async function findContacts(addresses: string[], tx: Tx): Promise<Map<string, ContactHit>> {
  if (addresses.length === 0) return new Map();
  const found = await rows<ContactHit>(
    sql`
    select c.id, lower(c.email) as email, c.company_id,
           coalesce(
             (select d.id from crm.deals d
               where d.primary_contact_id = c.id and d.deleted_at is null and d.stage not in ('won', 'lost')
               order by d.last_activity_at desc nulls last, d.created_at desc limit 1),
             -- otherwise the company's only open deal
             (select (array_agg(d.id))[1] from crm.deals d
               where c.company_id is not null and d.company_id = c.company_id and d.deleted_at is null
                 and d.stage not in ('won', 'lost')
              having count(*) = 1)
           ) as deal_id
    from crm.contacts c
    where c.deleted_at is null and lower(c.email) in (${sql.join(
      addresses.map((a) => sql`${a}`),
      sql`, `,
    )})`,
    tx,
  );
  return new Map(found.map((c) => [c.email, c]));
}

/** Log one page of messages. Returns how many activities and triage items were created. */
export async function recordMessages(ownerId: string, mailbox: string, folder: string, messages: GraphMessage[], ignore: ReadonlySet<string>) {
  const candidates = messages.map((m) => classify(m, ignore)).filter((c): c is Candidate => c.kind === "candidate");
  if (candidates.length === 0) return { logged: 0, triaged: 0 };

  return withActor(SYNC, async (tx) => {
    const contacts = await findContacts([...new Set(candidates.flatMap((c) => c.outside.map((p) => p.address)))], tx);
    const activities: SQL[] = [];
    const triage: SQL[] = [];

    for (const c of candidates) {
      const hits = c.outside.map((p) => contacts.get(p.address)).filter((h): h is ContactHit => !!h);
      const meta = JSON.stringify({ mailbox, folder, conversation_id: c.conversationId, message_id: c.messageId });
      for (const h of hits) {
        activities.push(sql`('email', ${c.direction}::crm.activity_direction, ${c.subject}, ${c.occurredAt}::timestamptz,
                             ${h.id}::uuid, ${h.company_id}::uuid, ${h.deal_id}::uuid, ${ownerId}::uuid, 'graph',
                             ${`${c.key}|${h.id}`}, ${c.webLink}, ${meta}::jsonb)`);
      }
      if (hits.length === 0 && c.direction === "inbound" && !c.automated && c.from) {
        triage.push(sql`(${ownerId}::uuid, ${c.key}, ${c.from.address}, ${c.from.name}, ${c.subject},
                         ${c.occurredAt}::timestamptz, ${c.webLink}, ${mailbox})`);
      }
    }

    let logged = 0;
    let triaged = 0;
    if (activities.length) {
      const r = await rows<{ id: string }>(
        sql`insert into crm.activities (type, direction, subject, occurred_at, contact_id, company_id, deal_id, owner_id,
                                        origin, external_id, external_url, metadata)
            values ${sql.join(activities, sql`, `)}
            on conflict (origin, external_id) where external_id is not null do nothing
            returning id`,
        tx,
      );
      logged = r.length;
      if (logged) await applyDealRules(r.map((x) => x.id), tx);
    }
    if (triage.length) {
      // One triage item per email, even if it reached two mailboxes.
      const r = await rows<{ id: string }>(
        sql`insert into crm.unmatched_emails (owner_id, external_id, from_address, from_name, subject, received_at, external_url, mailbox)
            select v.* from (values ${sql.join(triage, sql`, `)}) as v(owner_id, external_id, from_address, from_name, subject, received_at, external_url, mailbox)
            where not exists (select 1 from crm.unmatched_emails u where u.external_id = v.external_id)
            on conflict (owner_id, external_id) do nothing
            returning id`,
        tx,
      );
      triaged = r.length;
    }
    return { logged, triaged };
  });
}

/**
 * The brief's automatic pipeline rules for newly logged emails:
 *   - an email we sent moves a New enquiry deal to Contacted (sent after the deal was created);
 *   - a customer reply after the quote was sent creates a suggestion (a task) to move the deal to Negotiation.
 *     A person accepts or dismisses it; the stage never moves to Negotiation on its own.
 */
async function applyDealRules(activityIds: string[], tx: Tx) {
  const ids = sql.join(
    activityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  await tx.execute(sql`
    update crm.deals d set stage = 'contacted'
    where d.stage = 'new_enquiry' and d.deleted_at is null
      and exists (select 1 from crm.activities a
                  where a.id in (${ids}) and a.deal_id = d.id and a.direction = 'outbound' and a.occurred_at >= d.created_at)`);
  await tx.execute(sql`
    insert into crm.tasks (title, due_on, deal_id, contact_id, assigned_to, source, rule)
    select distinct on (d.id) 'Customer replied after the quote: move to Negotiation?', (now() at time zone 'Pacific/Auckland')::date,
           d.id, a.contact_id, d.owner_id, 'follow_up_engine', 'suggest_negotiation'
    from crm.activities a join crm.deals d on d.id = a.deal_id
    where a.id in (${ids}) and a.direction = 'inbound' and d.stage = 'quote_sent' and d.deleted_at is null
      and a.occurred_at > d.stage_changed_at
    order by d.id, a.occurred_at desc
    on conflict (deal_id, rule) where status = 'open' and source = 'follow_up_engine' and deal_id is not null do nothing`);
}

async function saveState(profileId: string, folder: Folder, patch: SQL) {
  await withActor(SYNC, async (tx) => {
    await tx.execute(sql`insert into crm.mail_sync_state (profile_id, folder) values (${profileId}, ${folder})
                         on conflict (profile_id, folder) do nothing`);
    await tx.execute(sql`update crm.mail_sync_state set ${patch}, last_run_at = now()
                         where profile_id = ${profileId} and folder = ${folder}`);
  });
}

export type DeltaState = { delta_link: string | null; next_link: string | null };
export type DeltaResult = { seen: number; logged: number; triaged: number; finished: boolean; error?: string };

/**
 * Follow one folder's change tracking until Microsoft says we're up to date, or the deadline passes (the saved
 * position lets the next run resume). Shared by the users' own folders and the shared mailboxes.
 */
export async function followDelta(opts: {
  readerId: string;
  state: DeltaState | undefined;
  startUrl: () => string;
  save: (patch: SQL) => Promise<void>;
  onPage: (messages: GraphMessage[]) => Promise<{ logged: number; triaged: number }>;
  deadline: number;
  fetchImpl?: typeof fetch;
}): Promise<DeltaResult> {
  const result: DeltaResult = { seen: 0, logged: 0, triaged: 0, finished: false };
  let url = opts.state?.next_link ?? opts.state?.delta_link ?? opts.startUrl();
  let restarted = !opts.state?.next_link && !opts.state?.delta_link;

  try {
    while (Date.now() < opts.deadline) {
      let page: Page;
      try {
        page = await graphGet<Page>(opts.readerId, url, opts.fetchImpl, { Prefer: `odata.maxpagesize=${PAGE_SIZE}` });
      } catch (e) {
        // Microsoft forgets old change-tracking links (410 Gone, "syncStateNotFound"): start the round again.
        if (e instanceof GraphError && (e.status === 410 || /syncState/i.test(e.code)) && !restarted) {
          restarted = true;
          url = opts.startUrl();
          await opts.save(sql`delta_link = null, next_link = null`);
          continue;
        }
        throw e;
      }
      const messages = page.value ?? [];
      const r = await opts.onPage(messages);
      result.seen += messages.length;
      result.logged += r.logged;
      result.triaged += r.triaged;

      const counts = sql`messages_seen = messages_seen + ${messages.length}, messages_logged = messages_logged + ${r.logged}`;
      if (page["@odata.nextLink"]) {
        url = page["@odata.nextLink"];
        await opts.save(sql`next_link = ${url}, last_error = null, ${counts}`);
      } else {
        await opts.save(sql`delta_link = ${page["@odata.deltaLink"] ?? null}, next_link = null,
                             last_success_at = now(), last_error = null, ${counts}`);
        result.finished = true;
        break;
      }
    }
  } catch (e) {
    result.error = describe(e);
    await opts.save(sql`last_error = ${result.error}`);
  }
  return result;
}

/** The start of a folder's change tracking: header fields only, received in the last `days` days. */
export function deltaStartUrl(folderPath: string, days: number, now: Date = new Date(), extraFields: string[] = []): string {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const q = new URLSearchParams({ $select: [MESSAGE_FIELDS, ...extraFields].join(","), $filter: `receivedDateTime ge ${since}` });
  return `https://graph.microsoft.com/v1.0${folderPath}/messages/delta?${q}`;
}

/** Read one of a user's own folders (Inbox or Sent Items). */
export async function syncFolder(
  profileId: string,
  mailbox: string,
  folder: Folder,
  opts: { deadline: number; ignore: ReadonlySet<string>; backfillDays: number; fetchImpl?: typeof fetch; now?: Date },
): Promise<FolderResult> {
  const [state] = await rows<DeltaState>(
    sql`select delta_link, next_link from crm.mail_sync_state where profile_id = ${profileId} and folder = ${folder}`,
  );
  const r = await followDelta({
    readerId: profileId,
    state,
    startUrl: () => deltaStartUrl(`/me/mailFolders/${folder}`, opts.backfillDays, opts.now ?? new Date()),
    save: (patch) => saveState(profileId, folder, patch),
    onPage: (messages) => recordMessages(profileId, mailbox, folder, messages, opts.ignore),
    deadline: opts.deadline,
    fetchImpl: opts.fetchImpl,
  });
  return { folder, ...r };
}

function describe(e: unknown): string {
  if (e instanceof MailNotConnected || e instanceof GraphError) return e.message;
  return e instanceof Error ? e.message.slice(0, 300) : "Unknown error";
}

/**
 * Sync every connected mailbox (or just one), within a time budget, then the shared enquiries mailboxes
 * (always on the scheduled run; on "Sync now" when asked, using that user's access).
 */
export async function syncMail(
  opts: { budgetMs?: number; profileId?: string; shared?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<SyncRun> {
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const accounts = (await listMailAccounts()).filter((a) => a.status === "connected" && (!opts.profileId || a.profile_id === opts.profileId));
  const [ignore, [setting]] = await Promise.all([
    loadIgnoreList(),
    rows<{ days: number | null }>(sql`select crm.setting_int('mail_backfill_days') as days`),
  ]);
  const backfillDays = setting?.days ?? 90;

  const mailboxes: MailboxResult[] = [];
  for (const a of accounts) {
    const r: MailboxResult = { profileId: a.profile_id, name: a.display_name, folders: [] };
    for (const folder of FOLDERS) {
      if (Date.now() >= deadline) break;
      const f = await syncFolder(a.profile_id, a.mailbox, folder, { deadline, ignore, backfillDays, fetchImpl: opts.fetchImpl });
      r.folders.push(f);
      if (f.error && /refresh access|not connected/i.test(f.error)) {
        r.error = f.error;
        break;
      }
    }
    mailboxes.push(r);
  }
  const shared =
    (opts.shared ?? !opts.profileId) && Date.now() < deadline
      ? await syncSharedMailboxes({ deadline, ignore, backfillDays, fetchImpl: opts.fetchImpl, onlyReader: opts.profileId })
      : [];
  await fileKnownSenders();
  return { mailboxes, shared };
}

/**
 * Triage items whose sender has since become a contact (added by hand, or by an import): log them on that contact
 * and close them, so nobody has to deal with them twice.
 */
export async function fileKnownSenders(actor: Actor = SYNC): Promise<number> {
  return withActor(actor, async (tx) => {
    const r = await rows<{ id: string }>(
      sql`
      with hits as (
        select u.id as unmatched_id, u.owner_id, u.external_id, u.subject, u.received_at, u.external_url, u.mailbox,
               c.id as contact_id, c.company_id
        from crm.unmatched_emails u
        join crm.contacts c on lower(c.email) = u.from_address and c.deleted_at is null
        where u.status = 'pending'
      ), logged as (
        insert into crm.activities (type, direction, subject, occurred_at, contact_id, company_id, owner_id, origin,
                                    external_id, external_url, metadata)
        select 'email', 'inbound', subject, received_at, contact_id, company_id, owner_id, 'graph',
               external_id || '|' || contact_id, external_url, jsonb_build_object('mailbox', mailbox, 'folder', 'inbox')
        from hits
        on conflict (origin, external_id) where external_id is not null do nothing
      )
      update crm.unmatched_emails u set status = 'accepted', contact_id = h.contact_id
      from hits h where u.id = h.unmatched_id
      returning u.id`,
      tx,
    );
    return r.length;
  });
}

export type SyncStatus = {
  profile_id: string;
  folder: Folder;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  messages_seen: number;
  messages_logged: number;
  catching_up: boolean;
};

export async function listSyncStatus(profileId?: string): Promise<SyncStatus[]> {
  return rows<SyncStatus>(sql`
    select profile_id, folder, last_run_at, last_success_at, last_error, messages_seen, messages_logged,
           (next_link is not null or delta_link is null) as catching_up
    from crm.mail_sync_state
    ${profileId ? sql`where profile_id = ${profileId}` : sql``}
    order by folder`);
}
