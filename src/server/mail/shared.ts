import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { isShopOrder, isWebsiteForm, SHARED_PREVIEW_FIELD, type GraphMessage } from "./classify";
import { GraphError, graphGet, SHARED_MAILBOXES } from "./graph";
import { deltaStartUrl, followDelta, recordMessages, type DeltaResult, type DeltaState } from "./sync";

// Shared mailboxes (phase 3.4): enquiries@saveboard.nz (NZ) and sales@saveboard.com.au (AUS). The CRM reads every
// mail folder except the system ones (Sent, Drafts, Deleted, Junk...), because staff file handled messages. It reads with
// a connected user's delegated access (Mail.Read.Shared) and never changes these mailboxes.
//   - Website form and shop order notifications are queued in crm.web_enquiries (see enquiries.ts).
//   - Everything else is handled like the users' own mail: known contacts logged, unknown senders to triage.

const SYNC: Actor = { type: "system", reason: "mail_sync" };
const MAX_FOLDERS = 60;
const MAX_DEPTH = 4;

type Folder = { id: string; displayName: string; childFolderCount?: number };
export type SharedFolderResult = DeltaResult & { path: string };
export type SharedMailboxResult = { mailbox: string; reader: string | null; folders: SharedFolderResult[]; queued: number; error?: string };

/** Connected users who could read the shared mailboxes, admins first. */
async function candidateReaders(): Promise<{ id: string; name: string }[]> {
  return rows<{ id: string; name: string }>(sql`
    select m.profile_id as id, p.display_name as name
    from crm.mail_accounts m join crm.profiles p on p.id = m.profile_id
    where m.status = 'connected' and p.active
    order by (p.role = 'admin') desc, p.display_name`);
}

/** Outlook's system folders, by their well-known names (language-independent). Never read. */
const SYSTEM_FOLDERS = ["drafts", "sentitems", "deleteditems", "junkemail", "outbox", "conversationhistory", "syncissues"];

/**
 * Every mail folder people file into, depth-first, Inbox first, as "Inbox", "Inbox/2026", "Enquiries": all top-level
 * folders and their subfolders except the system ones (staff file handled messages into folders, which can sit
 * under the Inbox or beside it).
 */
export async function listMailFolders(readerId: string, mailbox: string, fetchImpl?: typeof fetch): Promise<{ id: string; path: string }[]> {
  const box = `/users/${encodeURIComponent(mailbox)}`;
  // One request at a time: Outlook throttles more than a few concurrent requests per mailbox (ApplicationThrottled).
  const top = await graphGet<{ value?: Folder[] }>(readerId, `${box}/mailFolders?$select=id,displayName,childFolderCount&$top=100`, fetchImpl);
  const inbox = await graphGet<Folder>(readerId, `${box}/mailFolders/inbox?$select=id,displayName,childFolderCount`, fetchImpl);
  const skip = new Set<string>();
  for (const name of SYSTEM_FOLDERS) {
    const f = await graphGet<Folder>(readerId, `${box}/mailFolders/${name}?$select=id`, fetchImpl).catch(() => null);
    if (f) skip.add(f.id);
  }
  const roots = [inbox, ...(top.value ?? []).filter((f) => f.id !== inbox.id && !skip.has(f.id))];
  const out: { id: string; path: string }[] = [];
  async function walk(f: Folder, path: string, depth: number) {
    out.push({ id: f.id, path });
    if (!f.childFolderCount || depth >= MAX_DEPTH || out.length >= MAX_FOLDERS) return;
    const kids = await graphGet<{ value?: Folder[] }>(
      readerId,
      `${box}/mailFolders/${encodeURIComponent(f.id)}/childFolders?$select=id,displayName,childFolderCount&$top=100`,
      fetchImpl,
    );
    for (const k of kids.value ?? []) {
      if (out.length >= MAX_FOLDERS) break;
      await walk(k, `${path}/${k.displayName}`, depth + 1);
    }
  }
  for (const r of roots) {
    if (out.length >= MAX_FOLDERS) break;
    await walk(r, r.id === inbox.id ? "Inbox" : r.displayName, 0);
  }
  return out;
}

/** Queue website forms and shop orders; return the rest for normal logging. */
async function queueNotifications(readerId: string, mailbox: string, entity: "NZ" | "AUS", messages: GraphMessage[]) {
  const queue: SQL[] = [];
  const rest: GraphMessage[] = [];
  for (const m of messages) {
    const key = m.internetMessageId?.trim();
    const kind = isWebsiteForm(m.subject, m.bodyPreview) ? "form" : isShopOrder(m.subject, m.bodyPreview) ? "shop_order" : null;
    if (!kind || !key || m["@removed"] || m.isDraft) {
      rest.push(m);
      continue;
    }
    queue.push(sql`(${kind}, ${mailbox}, ${entity}, ${key}, ${m.id}, ${readerId}::uuid, ${m.subject ?? null},
                    ${m.receivedDateTime ?? new Date().toISOString()}::timestamptz, 'pending')`);
  }
  let queued = 0;
  if (queue.length) {
    const r = await withActor(SYNC, async (tx) => {
      const out = await rows<{ id: string; inserted: boolean; external_id: string }>(
        sql`insert into crm.web_enquiries (kind, mailbox, entity, external_id, message_id, reader_id, subject, received_at, status)
            values ${sql.join(queue, sql`, `)}
            on conflict (external_id) do update set message_id = excluded.message_id   -- moved to another folder: new id
            returning (xmax = 0) as inserted, id, external_id`,
        tx,
      );
      // A form or order read before it was recognised as one (e.g. before a re-read) may sit in triage or on a
      // timeline as plain email: it is logged once, as the enquiry or order, so remove those copies.
      const keys = sql.join(
        out.map((x) => sql`${x.external_id}`),
        sql`, `,
      );
      await tx.execute(sql`update crm.unmatched_emails set status = 'ignored' where status = 'pending' and external_id in (${keys})`);
      await tx.execute(sql`delete from crm.activities where origin = 'graph' and split_part(external_id, '|', 1) in (${keys})`);
      return out;
    });
    queued = r.filter((x) => x.inserted).length;
  }
  return { queued, rest };
}

async function saveFolder(mailbox: string, folderId: string, patch: SQL) {
  await withActor(SYNC, (tx) =>
    tx.execute(sql`update crm.shared_mail_folders set ${patch}, last_run_at = now() where mailbox = ${mailbox} and folder_id = ${folderId}`),
  );
}

/** Read both shared mailboxes within the deadline. */
export async function syncSharedMailboxes(opts: {
  deadline: number;
  ignore: ReadonlySet<string>;
  backfillDays: number;
  fetchImpl?: typeof fetch;
  onlyReader?: string;
}): Promise<SharedMailboxResult[]> {
  const readers = (await candidateReaders()).filter((r) => !opts.onlyReader || r.id === opts.onlyReader);
  const results: SharedMailboxResult[] = [];

  for (const { address: mailbox, entity } of SHARED_MAILBOXES) {
    const result: SharedMailboxResult = { mailbox, reader: null, folders: [], queued: 0 };
    results.push(result);
    if (Date.now() >= opts.deadline) break;

    // Use whoever read it last time if they still can; otherwise the first connected user with access.
    const [last] = await rows<{ reader_id: string | null }>(
      sql`select reader_id from crm.shared_mail_folders where mailbox = ${mailbox} and reader_id is not null limit 1`,
    );
    const ordered = [...readers].sort((a, b) => Number(b.id === last?.reader_id) - Number(a.id === last?.reader_id));
    let folders: { id: string; path: string }[] | null = null;
    let reader: { id: string; name: string } | null = null;
    for (const r of ordered) {
      try {
        folders = await listMailFolders(r.id, mailbox, opts.fetchImpl);
        reader = r;
        break;
      } catch (e) {
        result.error = e instanceof GraphError ? `${r.name}: ${e.code}` : `${r.name}: ${e instanceof Error ? e.message : "failed"}`;
      }
    }
    if (!reader || !folders) {
      result.error ??= "No connected user can open this mailbox";
      continue;
    }
    result.error = undefined;
    result.reader = reader.name;

    await withActor(SYNC, async (tx) => {
      for (const f of folders) {
        await tx.execute(sql`
          insert into crm.shared_mail_folders (mailbox, folder_id, folder_path, reader_id) values (${mailbox}, ${f.id}, ${f.path}, ${reader.id})
          on conflict (mailbox, folder_id) do update set folder_path = excluded.folder_path, reader_id = excluded.reader_id`);
      }
    });

    for (const f of folders) {
      if (Date.now() >= opts.deadline) break;
      const [state] = await rows<DeltaState>(
        sql`select delta_link, next_link from crm.shared_mail_folders where mailbox = ${mailbox} and folder_id = ${f.id}`,
      );
      const r = await followDelta({
        readerId: reader.id,
        state,
        startUrl: () =>
          deltaStartUrl(`/users/${encodeURIComponent(mailbox)}/mailFolders/${encodeURIComponent(f.id)}`, opts.backfillDays, undefined, [
            SHARED_PREVIEW_FIELD,
          ]),
        save: (patch) => saveFolder(mailbox, f.id, patch),
        onPage: async (messages) => {
          const { queued, rest } = await queueNotifications(reader.id, mailbox, entity, messages);
          result.queued += queued;
          return recordMessages(reader.id, mailbox, f.path, rest, opts.ignore);
        },
        deadline: opts.deadline,
        fetchImpl: opts.fetchImpl,
      });
      result.folders.push({ path: f.path, ...r });
    }
  }
  return results;
}

export type SharedFolderStatus = {
  mailbox: string;
  folder_path: string;
  reader: string | null;
  last_run_at: string | null;
  last_error: string | null;
  messages_seen: number;
  messages_logged: number;
  catching_up: boolean;
};

export async function listSharedStatus(): Promise<SharedFolderStatus[]> {
  return rows<SharedFolderStatus>(sql`
    select f.mailbox, f.folder_path, p.display_name as reader, f.last_run_at, f.last_error, f.messages_seen, f.messages_logged,
           (f.next_link is not null or f.delta_link is null) as catching_up
    from crm.shared_mail_folders f left join crm.profiles p on p.id = f.reader_id
    order by f.mailbox, f.folder_path`);
}

/**
 * Start the shared mailboxes' change tracking again from the 90-day read-back (admin, health page). Used after the
 * rules for recognising forms or orders change. Safe: every email, form and order is logged at most once.
 */
export async function rereadSharedMailboxes(actor: Actor & { type: "user" }): Promise<void> {
  await withActor(actor, (tx) => tx.execute(sql`update crm.shared_mail_folders set delta_link = null, next_link = null`));
}
