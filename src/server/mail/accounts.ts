import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";
import { withActor, type Actor } from "@/server/db/actor";
import { decryptToken, encryptToken } from "./crypto";

// Outlook connections (crm.mail_accounts, migration 9). Tokens are encrypted before they reach the database and are
// never returned to pages: only the status fields below are.

export type MailAccountStatus = {
  profile_id: string;
  display_name: string;
  mailbox: string;
  scopes: string;
  status: "connected" | "needs_reconnect";
  connected_at: string;
  last_refresh_at: string | null;
  last_error: string | null;
};

const SELECT_STATUS = sql`
  select m.profile_id, p.display_name, m.mailbox, m.scopes, m.status, m.connected_at, m.last_refresh_at, m.last_error
  from crm.mail_accounts m join crm.profiles p on p.id = m.profile_id`;

export async function saveMailAccount(actor: Actor, profileId: string, mailbox: string, refreshToken: string, scopes: string): Promise<void> {
  const enc = encryptToken(refreshToken);
  await withActor(actor, (tx) =>
    tx.execute(sql`
      insert into crm.mail_accounts (profile_id, mailbox, refresh_token_enc, scopes, status, connected_at, last_error)
      values (${profileId}, ${mailbox}, ${enc}, ${scopes}, 'connected', now(), null)
      on conflict (profile_id) do update
         set mailbox = excluded.mailbox, refresh_token_enc = excluded.refresh_token_enc, scopes = excluded.scopes,
             status = 'connected', connected_at = now(), last_error = null`),
  );
}

export async function getMailAccount(profileId: string): Promise<MailAccountStatus | null> {
  const [r] = await rows<MailAccountStatus>(sql`${SELECT_STATUS} where m.profile_id = ${profileId}`);
  return r ?? null;
}

export async function listMailAccounts(): Promise<MailAccountStatus[]> {
  return rows<MailAccountStatus>(sql`${SELECT_STATUS} order by p.display_name`);
}

export async function deleteMailAccount(actor: Actor, profileId: string): Promise<void> {
  await withActor(actor, (tx) => tx.execute(sql`delete from crm.mail_accounts where profile_id = ${profileId}`));
}

/** For the Graph client only: the decrypted refresh token, or null if the user hasn't connected. */
export async function loadRefreshToken(profileId: string): Promise<string | null> {
  const [r] = await rows<{ refresh_token_enc: string; status: string }>(
    sql`select refresh_token_enc, status from crm.mail_accounts where profile_id = ${profileId}`,
  );
  return r && r.status === "connected" ? decryptToken(r.refresh_token_enc) : null;
}

/** Microsoft rotates refresh tokens: keep the newest one. */
export async function storeRotatedToken(profileId: string, refreshToken: string): Promise<void> {
  const enc = encryptToken(refreshToken);
  await withActor({ type: "system", reason: "import" }, (tx) =>
    tx.execute(sql`update crm.mail_accounts set refresh_token_enc = ${enc}, last_refresh_at = now(), last_error = null
                   where profile_id = ${profileId}`),
  );
}

export async function markNeedsReconnect(profileId: string, error: string): Promise<void> {
  await withActor({ type: "system", reason: "import" }, (tx) =>
    tx.execute(sql`update crm.mail_accounts set status = 'needs_reconnect', last_error = ${error.slice(0, 500)}
                   where profile_id = ${profileId}`),
  );
}
