import "server-only";
import { authStatus } from "@/server/auth/config";
import { loadRefreshToken, markNeedsReconnect, storeRotatedToken } from "./accounts";

// Microsoft Graph on behalf of a connected user (delegated permissions only). The CRM can read mail and create
// drafts; it never has permission to send (CLAUDE.md hard rule 4).

/**
 * Scopes requested when a user clicks "Connect Outlook". Mail.ReadWrite: own mailbox, read + drafts.
 * Mail.Read.Shared: READ the shared enquiries mailboxes the user already has access to in Outlook.
 * Never add the send-mail permission.
 */
export const MAIL_SCOPES = "openid profile email offline_access User.Read Mail.ReadWrite Mail.Read.Shared";

/** The shared mailboxes where website enquiries land (phase 3 plan: "Where forms land"). Read-only. */
export const SHARED_MAILBOXES = [
  { entity: "NZ", address: "enquiries@saveboard.nz" },
  { entity: "AUS", address: "sales@saveboard.com.au" },
] as const;

export class MailNotConnected extends Error {
  constructor(message = "Outlook is not connected for this user") {
    super(message);
    this.name = "MailNotConnected";
  }
}

const cache = new Map<string, { token: string; expiresAt: number }>();

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

/** A short-lived access token for this user, refreshed from the stored (encrypted) refresh token when needed. */
export async function graphToken(profileId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const hit = cache.get(profileId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const status = authStatus();
  if (!status.configured) throw new MailNotConnected("Sign-in settings are incomplete");
  const refresh = await loadRefreshToken(profileId);
  if (!refresh) throw new MailNotConnected();

  const res = await fetchImpl(`https://login.microsoftonline.com/${status.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? "",
      client_secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refresh,
      scope: MAIL_SCOPES,
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || !body.access_token) {
    const reason = `${body.error ?? res.status}: ${(body.error_description ?? "").split("\r\n")[0]}`;
    // invalid_grant = revoked, expired or password changed: the user must connect again.
    if (body.error === "invalid_grant" || body.error === "interaction_required") await markNeedsReconnect(profileId, reason);
    throw new MailNotConnected(`Microsoft refused to refresh access (${reason})`);
  }
  if (body.refresh_token) await storeRotatedToken(profileId, body.refresh_token);
  cache.set(profileId, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

export function forgetGraphToken(profileId: string) {
  cache.delete(profileId);
}

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

/**
 * GET from Graph as this user: a path ("/me/mailFolders/inbox") or a full link Graph handed back (paging and
 * change-tracking links). Only graph.microsoft.com is ever called with the token.
 */
export async function graphGet<T>(profileId: string, pathOrUrl: string, fetchImpl: typeof fetch = fetch, headers: Record<string, string> = {}): Promise<T> {
  const url = pathOrUrl.startsWith("/") ? `${GRAPH}${pathOrUrl}` : pathOrUrl;
  if (!url.startsWith(`${GRAPH}/`)) throw new Error("Refusing to send the Microsoft token outside graph.microsoft.com");
  const token = await graphToken(profileId, fetchImpl);
  let res = await fetchImpl(url, { headers: { ...headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
  // Throttled (429, e.g. "ApplicationThrottled": Outlook allows only a few requests at a time per mailbox): wait as
  // Microsoft asks (at most 10 seconds) and try once more.
  if (res.status === 429 || res.status === 503) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await fetchImpl(url, { headers: { ...headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? String(res.status);
    if (res.status === 401) forgetGraphToken(profileId);
    throw new GraphError(res.status, code, `Microsoft Graph returned ${res.status} (${code})`);
  }
  return (await res.json()) as T;
}

type FolderCounts = { displayName: string; totalItemCount: number; unreadItemCount: number };
const COUNTS = "mailFolders/inbox?$select=displayName,totalItemCount,unreadItemCount";

/**
 * A harmless read to prove the connection works: the user's Inbox counts, and whether each shared enquiries
 * mailbox can be opened (needs Mail.Read.Shared plus the user's own access to that mailbox).
 */
export async function testMailConnection(profileId: string, fetchImpl: typeof fetch = fetch) {
  const inbox = await graphGet<FolderCounts>(profileId, `/me/${COUNTS}`, fetchImpl);
  const shared = await Promise.all(
    SHARED_MAILBOXES.map(async (m) => {
      try {
        const c = await graphGet<FolderCounts>(profileId, `/users/${encodeURIComponent(m.address)}/${COUNTS}`, fetchImpl);
        return { ...m, ok: true as const, total: c.totalItemCount };
      } catch (e) {
        return { ...m, ok: false as const, problem: e instanceof GraphError ? e.code : "not reachable" };
      }
    }),
  );
  return { ...inbox, shared };
}
